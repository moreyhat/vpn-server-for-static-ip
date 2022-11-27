# VPN server for static IP address
This repository is for provisioning VPN server for static IP address.  
The server will be deployed on AWS.

# Get started
## Require
The follwoing tools are required to deploy VPN server.
- [Node.js](https://nodejs.org/)
- [Pulumi](https://www.pulumi.com/docs/get-started/install/)

## Deloy VPN server
1. Clone the repository
    ```shell
    git clone https://github.com/moreyhat/vpn-server-for-static-ip.git
    ```
1. Install dependencies
    ```shell
    cd vpn-server-for-static-ip
    npm install
    ```
1. Create Pulumi stack
    ```shell
    pulumi stack init [stackname]
    ```
1. Set an AWS region
    ```shell
    pulumi config set aws:region [region]
    ```
1. [Optional] Set source CIDR block to assess  
    You can put an source IP address restriction to access the VPN server. The client can access the VPN server only from the CIDR range when putting the restriction. This configuration is optional. If you omit this configuration, the server can be accessed from anywhere.
    ```shell
    pulumi config set source-cidr [CIDR block]
    ```
1. Deploy VPN server
    ```shell
    pulumi up -y
    ```