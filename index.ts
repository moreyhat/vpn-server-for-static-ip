import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const config = new pulumi.Config();
const sourceCidr = config.get("source-cidr") || "0.0.0.0/0";

const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
});

const igw = new aws.ec2.InternetGateway("igw", {
    vpcId: vpc.id,
    tags: {
        Name: "VPN server",
    },
});

const subnet = new aws.ec2.Subnet("subnet", {
    vpcId: vpc.id,
    cidrBlock: "10.0.0.0/24",
    tags: {
        Name: "VPN server subnet",
    },
});

const routeTable = new aws.ec2.RouteTable("route-table", {
    vpcId: vpc.id,
});

new aws.ec2.Route("default-route", {
    routeTableId: routeTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: igw.id,
});

new aws.ec2.RouteTableAssociation("route-table-association", {
    subnetId: subnet.id,
    routeTableId: routeTable.id,
});

const securityGroup = new aws.ec2.SecurityGroup("security-group", {
    description: "VPN server security group",
    vpcId: vpc.id,
    ingress: [{
        description: "VPN",
        fromPort: 1194,
        toPort: 1194,
        protocol: "udp",
        cidrBlocks: [
            sourceCidr,
        ],
    }],
    egress: [{
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
        ipv6CidrBlocks: ["::/0"],
    }],
    tags: {
        Name: "SG for VPN server",
    },
});

const bucket = new aws.s3.Bucket("bucket", {
    forceDestroy: true,
});

const s3_policy = new aws.iam.Policy("s3-policy", {
    path: "/",
    description: "Managed policy for S3 access",
    policy: bucket.arn.apply(arn => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: ["s3:PutObject"],
            Effect: "Allow",
            Resource: arn + "/*",
        }],
    })),
});

const amazonLinux2 = aws.ec2.getAmi({
    mostRecent: true,
    filters: [
        {
            name: "name",
            values: ["amzn2-ami-kernel-*"]
        },
        {
            name: "virtualization-type",
            values: ["hvm"]
        },
    ],
    owners: ["amazon"],
});

const ec2Role = new aws.iam.Role("ec2-role",{
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "ec2.amazonaws.com",
            },
        }],
    }),
    managedPolicyArns: [
        "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        s3_policy.arn,
    ],
});

const eip = new aws.ec2.Eip("elastic-ip", {
    vpc: true,
});

const userData = pulumi.interpolate `#!/bin/bash
amazon-linux-extras install -y epel
yum update -y
yum install -y openvpn

wget https://github.com/OpenVPN/easy-rsa/releases/download/v3.1.1/EasyRSA-3.1.1.tgz
tar -xvzf EasyRSA-3.1.1.tgz
mv EasyRSA-3.1.1 /usr/local/EasyRSA

cd /usr/local/EasyRSA/
echo "set_var EASYRSA_BATCH \\"1\\"" >> vars
./easyrsa init-pki
./easyrsa build-ca nopass
./easyrsa gen-dh
./easyrsa build-server-full server nopass
./easyrsa build-client-full client nopass
openvpn --genkey --secret /etc/openvpn/ta.key

cp pki/ca.crt /etc/openvpn/
cp pki/issued/server.crt /etc/openvpn/
cp pki/private/server.key /etc/openvpn/
cp pki/dh.pem /etc/openvpn/dh2048.pem

echo "port 1194" >> /etc/openvpn/server.conf
echo "proto udp" >> /etc/openvpn/server.conf
echo "dev tun" >> /etc/openvpn/server.conf
echo "ca ca.crt" >> /etc/openvpn/server.conf
echo "cert server.crt" >> /etc/openvpn/server.conf
echo "key server.key" >> /etc/openvpn/server.conf
echo "dh dh2048.pem" >> /etc/openvpn/server.conf
echo "server 192.168.100.0 255.255.255.0" >> /etc/openvpn/server.conf
echo "ifconfig-pool-persist ipp.txt" >> /etc/openvpn/server.conf
echo "ifconfig-pool-persist ipp.txt" >> /etc/openvpn/server.conf
echo "push \\"route 10.0.0.0 255.255.0.0\\"" >> /etc/openvpn/server.conf
echo "push \\"redirect-gateway def1\\"" >> /etc/openvpn/server.conf
echo "push \\"dhcp-option DNS 10.0.0.2\\"" >> /etc/openvpn/server.conf

echo "client" >> /tmp/client.ovpn
echo "dev tun" >> /tmp/client.ovpn
echo "proto udp" >> /tmp/client.ovpn
echo "remote ${eip.publicIp} 1194" >> /tmp/client.ovpn
echo "ca ca.crt" >> /tmp/client.ovpn
echo "cert client.crt" >> /tmp/client.ovpn
echo "key client.key" >> /tmp/client.ovpn

echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf
sysctl -p

iptables -t nat -A POSTROUTING -s 192.168.100.0/24 -o eth0 -j MASQUERADE

systemctl start openvpn@server
systemctl enable openvpn@server

aws s3 cp /tmp/client.ovpn s3://${bucket.bucket}/ --region ${bucket.region}
aws s3 cp /etc/openvpn/ca.crt s3://${bucket.bucket}/ --region ${bucket.region}
aws s3 cp /usr/local/EasyRSA/pki/issued/client.crt s3://${bucket.bucket}/ --region ${bucket.region}
aws s3 cp /usr/local/EasyRSA/pki/private/client.key s3://${bucket.bucket}/ --region ${bucket.region}
`

const vpnServer = new aws.ec2.Instance("vpn-server",{
    ami: amazonLinux2.then(amazonLinux2 => amazonLinux2.id),
    instanceType: "t3.nano",
    tags: {
        Name: "VPN server"
    },
    subnetId: subnet.id,
    associatePublicIpAddress: true,
    userData: userData,
    userDataReplaceOnChange: true,
    iamInstanceProfile: new aws.iam.InstanceProfile("ec2-instance-profile", { role: ec2Role }),
    sourceDestCheck: false,
    vpcSecurityGroupIds: [
        securityGroup.id,
    ],
});
const eipAssociation = new aws.ec2.EipAssociation("eip-association", {
    instanceId: vpnServer.id,
    allocationId: eip.id,
});

new aws.ec2.Route("vpn-route", {
    routeTableId: routeTable.id,
    destinationCidrBlock: "192.168.100.0/24",
    networkInterfaceId: eipAssociation.networkInterfaceId,
});
