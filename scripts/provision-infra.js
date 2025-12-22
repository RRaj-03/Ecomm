const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables
const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envConfig = {};
envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
        envConfig[key.trim()] = value.trim();
    }
});

process.env.AWS_ACCESS_KEY_ID = envConfig.AWS_ACCESS_KEY;
process.env.AWS_SECRET_ACCESS_KEY = envConfig.AWS_SECRET;
process.env.AWS_DEFAULT_REGION = 'ap-south-1'; // Mumbai

const RUN_ID = Date.now().toString().slice(-4);
const KEY_NAME = `ecomm-deploy-key-${RUN_ID}`;
const KEY_FILE = path.join(__dirname, `${KEY_NAME}.pem`);

// Rollback Tracker
const createdResources = {
    keyPair: null,
    securityGroups: [],
    instances: []
};

function runCommand(command) {
    try {
        return execSync(command, { stdio: 'pipe' }).toString().trim();
    } catch (error) {
        throw new Error(`Command failed: ${command}\nStderr: ${error.stderr ? error.stderr.toString() : error.message}`);
    }
}

function cleanup() {
    console.log('\n⚠️ Error occurred. Rolling back resources...');
    
    // Terminate Instances
    if (createdResources.instances.length > 0) {
        console.log(`Terminating instances: ${createdResources.instances.join(', ')}...`);
        try {
            runCommand(`aws ec2 terminate-instances --instance-ids ${createdResources.instances.join(' ')}`);
            console.log('✅ Instances terminated.');
            console.log('⏳ Waiting for termination to clear Security Groups...');
            runCommand(`aws ec2 wait instance-terminated --instance-ids ${createdResources.instances.join(' ')}`);
        } catch (e) {
            console.error('❌ Failed to terminate instances:', e.message);
        }
    }

    // Delete Security Groups
    // Reverse order to handle dependencies (DB depends on App)
    for (const sgId of createdResources.securityGroups.reverse()) {
        console.log(`Deleting SG: ${sgId}...`);
        try {
            // Retries for dependency delays
            runCommand(`aws ec2 delete-security-group --group-id ${sgId}`);
            console.log('✅ SG deleted.');
        } catch (e) {
            console.error(`❌ Failed to delete SG ${sgId}:`, e.message);
        }
    }

    // Delete Key Pair
    if (createdResources.keyPair) {
        console.log(`Deleting Key Pair: ${createdResources.keyPair}...`);
        try {
            runCommand(`aws ec2 delete-key-pair --key-name ${createdResources.keyPair}`);
            fs.unlinkSync(KEY_FILE);
            console.log('✅ Key pair deleted.');
        } catch (e) {
            console.error('❌ Failed to delete key pair:', e.message);
        }
    }
}

async function main() {
    try {
        console.log('🚀 Starting AWS Infrastructure Provisioning...');

        // 1. Create Key Pair
        console.log(`\n🔑 Creating Key Pair: ${KEY_NAME}...`);
        const keyMaterial = runCommand(`aws ec2 create-key-pair --key-name ${KEY_NAME} --query 'KeyMaterial' --output text`);
        fs.writeFileSync(KEY_FILE, keyMaterial, { mode: 0o400 });
        createdResources.keyPair = KEY_NAME;
        console.log(`✅ Key pair saved to ${KEY_FILE}`);

        // 2. Create Security Groups
        const VPC_ID = runCommand(`aws ec2 describe-vpcs --query "Vpcs[0].VpcId" --output text`);
        console.log(`\nUsing VPC: ${VPC_ID}`);

        // App SG
        const APP_SG_NAME = `ecomm-app-sg-${RUN_ID}`;
        console.log(`🛡️ Creating App Security Group: ${APP_SG_NAME}...`);
        const APP_SG_ID = runCommand(`aws ec2 create-security-group --group-name ${APP_SG_NAME} --description "Security group for Ecomm App" --vpc-id ${VPC_ID} --query 'GroupId' --output text`);
        createdResources.securityGroups.push(APP_SG_ID); // Track
        runCommand(`aws ec2 authorize-security-group-ingress --group-id ${APP_SG_ID} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
        runCommand(`aws ec2 authorize-security-group-ingress --group-id ${APP_SG_ID} --protocol tcp --port 80 --cidr 0.0.0.0/0`);
        console.log(`✅ App SG Created: ${APP_SG_ID}`);

        // DB SG
        const DB_SG_NAME = `ecomm-db-sg-${RUN_ID}`;
        console.log(`🛡️ Creating DB Security Group: ${DB_SG_NAME}...`);
        const DB_SG_ID = runCommand(`aws ec2 create-security-group --group-name ${DB_SG_NAME} --description "Security group for Ecomm DB" --vpc-id ${VPC_ID} --query 'GroupId' --output text`);
        createdResources.securityGroups.push(DB_SG_ID); // Track
        runCommand(`aws ec2 authorize-security-group-ingress --group-id ${DB_SG_ID} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
        runCommand(`aws ec2 authorize-security-group-ingress --group-id ${DB_SG_ID} --protocol tcp --port 5432 --source-group ${APP_SG_ID}`);
        console.log(`✅ DB SG Created: ${DB_SG_ID}`);

        // 3. Launch Instances
        // Amazon Linux 2 (App)
        console.log('\n🔍 Finding latest Amazon Linux 2 AMI...');
        const FOUND_APP_AMI = runCommand(`aws ec2 describe-images --owners amazon --filters "Name=name,Values=amzn2-ami-hvm-*-x86_64-gp2" --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text`);

        // Amazon Linux 2023 (DB)
        console.log('🔍 Finding latest Amazon Linux 2023 AMI...');
        const FOUND_DB_AMI = runCommand(`aws ec2 describe-images --owners amazon --filters "Name=name,Values=al2023-ami-2023.*-x86_64" --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text`);

        // Launch App Instance
        console.log(`\n🚀 Launching App Server (t2.micro)...`);
        const APP_INSTANCE_ID = runCommand(`aws ec2 run-instances --image-id ${FOUND_APP_AMI} --count 1 --instance-type t2.micro --key-name ${KEY_NAME} --security-group-ids ${APP_SG_ID} --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=Ecomm-App}]' --query 'Instances[0].InstanceId' --output text`);
        createdResources.instances.push(APP_INSTANCE_ID);
        console.log(`✅ App Instance Launched: ${APP_INSTANCE_ID}`);

        // Launch DB Instance
        console.log(`🚀 Launching DB Server (t2.micro)...`);
        const DB_INSTANCE_ID = runCommand(`aws ec2 run-instances --image-id ${FOUND_DB_AMI} --count 1 --instance-type t2.micro --key-name ${KEY_NAME} --security-group-ids ${DB_SG_ID} --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=Ecomm-DB}]' --query 'Instances[0].InstanceId' --output text`);
        createdResources.instances.push(DB_INSTANCE_ID);
        console.log(`✅ DB Instance Launched: ${DB_INSTANCE_ID}`);

        console.log(`\n⏳ Waiting for instances to be running...`);
        runCommand(`aws ec2 wait instance-running --instance-ids ${APP_INSTANCE_ID} ${DB_INSTANCE_ID}`);

        // Get Public IPs
        const APP_IP = runCommand(`aws ec2 describe-instances --instance-ids ${APP_INSTANCE_ID} --query "Reservations[0].Instances[0].PublicIpAddress" --output text`);
        const DB_IP = runCommand(`aws ec2 describe-instances --instance-ids ${DB_INSTANCE_ID} --query "Reservations[0].Instances[0].PublicIpAddress" --output text`);

        // Output Info
        const info = `
--- DEPLOYMENT INFO ---
Key File: ${KEY_FILE}
App Server IP: ${APP_IP}
DB Server IP: ${DB_IP}

SSH Commands:
ssh -i "${KEY_FILE}" ec2-user@${APP_IP}
ssh -i "${KEY_FILE}" ec2-user@${DB_IP}

DB Connection String (Internal): postgresql://ecommerce_admin:secure_password@${DB_IP}:5432/ecommerce
DB Connection String (External Setup): postgresql://ecommerce_admin:secure_password@${DB_IP}:5432/ecommerce

NEXT STEPS:
1. Run setup-db-ec2.sh on DB Server.
2. Run setup-ec2.sh on App Server.
-----------------------
`;
        console.log(info);
        fs.writeFileSync(path.join(__dirname, 'deployment-info.txt'), info);
        console.log('✅ Deployment info saved to scripts/deployment-info.txt');

    } catch (error) {
        console.error('\n❌ CRITICAL ERROR:', error.message);
        cleanup();
        process.exit(1);
    }
}

main();
