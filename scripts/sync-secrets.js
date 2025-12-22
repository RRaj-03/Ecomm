const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ensure dependencies are installed
try {
    require.resolve('@octokit/core');
    require.resolve('sodium-native');
} catch (e) {
    console.log('📦 Installing dependencies (@octokit/core, sodium-native)...');
    execSync('npm install @octokit/core sodium-native', { stdio: 'inherit', cwd: __dirname });
}

const { Octokit } = require('@octokit/core');
const sodium = require('sodium-native');

// Configuration
const REPO_OWNER = 'RRaj-03';
const REPO_NAME = 'Ecomm'; // Derived from remote URL earlier
// GITHUB_PAT should be passed via env or prompt
const GITHUB_TOKEN = process.env.GITHUB_PAT;

if (!GITHUB_TOKEN) {
    console.error('❌ Error: GITHUB_PAT environment variable is missing.');
    console.error('Please run: GITHUB_PAT=your_token node scripts/sync-secrets.js');
    process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Secrets to set (Values from app-env and provisioned infra)
// We need to read these values.
// Loading from ../app-env and ../scripts/deployment-info.txt
// But simplistically, let's just grab them from process.env if set, OR read the know files.

function getEnvValue(key, content) {
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : null;
}

const appEnvPath = path.join(__dirname, '../app-env');
const appEnvContent = fs.readFileSync(appEnvPath, 'utf-8');

const deployInfoPath = path.join(__dirname, 'deployment-info.txt');
const deployInfoContent = fs.existsSync(deployInfoPath) ? fs.readFileSync(deployInfoPath, 'utf-8') : '';

// Helper to extract IP from info text
function getIP(serverType) {
    const match = deployInfoContent.match(new RegExp(`${serverType} Server IP: (.*)`));
    return match ? match[1].trim() : null;
}

const KEY_FILE_PATH = path.join(__dirname, 'ecomm-deploy-key-8923.pem'); // Hardcoded from previous step, ideally dynamic or finding newest .pem
// Let's find the .pem file dynamically if needed, or assume the user hasn't deleted it.
const keyContent = fs.readFileSync(KEY_FILE_PATH, 'utf-8');

const secrets = {
    EC2_HOST: getIP('App'),
    EC2_SSH_KEY: keyContent,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: getEnvValue('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', appEnvContent),
    NEXT_PUBLIC_API_URL_ADMIN: getEnvValue('NEXT_PUBLIC_API_URL_ADMIN', appEnvContent),
    FRONTEND_STORE_URL: getEnvValue('FRONTEND_STORE_URL', appEnvContent),
    STRIPE_API_KEY: getEnvValue('STRIPE_API_KEY', appEnvContent), // Note: This was placeholder in app-env
    STRIPE_WEBHOOK_SECRET: getEnvValue('STRIPE_WEBHOOK_SECRET', appEnvContent), // Placeholder
    CLOUDINARY_API_KEY: getEnvValue('CLOUDINARY_API_KEY', appEnvContent),
    CLOUDINARY_API_SECRET: getEnvValue('CLOUDINARY_API_SECRET', appEnvContent),
    HUGGINGFACE_API_KEY: getEnvValue('HUGGINGFACE_API_KEY', appEnvContent),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder_admin', // User needs to provide
    NEXT_PUBLIC_API_URL_STORE: getEnvValue('NEXT_PUBLIC_API_URL_STORE', appEnvContent),
    NEXT_PUBLIC_API_URL_STORE: getEnvValue('NEXT_PUBLIC_API_URL_STORE', appEnvContent),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY_STORE: 'pk_test_placeholder_store', // User needs to provide
    DATABASE_URL: 'postgresql://ecommerce_admin:secure_password@65.0.45.195:5432/ecommerce'
};

async function encryptSecret(key, value) {
    // Convert key and value to buffers
    const keyBytes = Buffer.from(key, 'base64');
    const messageBytes = Buffer.from(value);
    
    // Encrypt
    const encryptedBytes = Buffer.alloc(messageBytes.length + sodium.crypto_box_SEALBYTES);
    sodium.crypto_box_seal(encryptedBytes, messageBytes, keyBytes);
    
    return encryptedBytes.toString('base64');
}

async function setSecret(name, value) {
    if (!value || value.includes('placeholder')) {
        console.warn(`⚠️ Skipping ${name}: Value missing or placeholder.`);
        return;
    }

    try {
        console.log(`🔐 Setting secret: ${name}...`);
        
        // 1. Get Public Key
        const { data: publicKey } = await octokit.request('GET /repos/{owner}/{repo}/actions/secrets/public-key', {
            owner: REPO_OWNER,
            repo: REPO_NAME
        });

        // 2. Encrypt
        const encryptedValue = await encryptSecret(publicKey.key, value);

        // 3. Put Secret
        await octokit.request('PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}', {
            owner: REPO_OWNER,
            repo: REPO_NAME,
            secret_name: name,
            encrypted_value: encryptedValue,
            key_id: publicKey.key_id
        });
        console.log(`✅ ${name} set successfully.`);
    } catch (e) {
        console.error(`❌ Failed to set ${name}:`, e.message);
    }
}

async function main() {
    console.log(`🚀 Syncing secrets to ${REPO_OWNER}/${REPO_NAME}...`);
    for (const [key, value] of Object.entries(secrets)) {
        await setSecret(key, value);
    }
    console.log('Secrets sync complete.');
}

main();
