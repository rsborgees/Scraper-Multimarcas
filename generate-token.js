const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost'; // Usando localhost pois url OOB foi bloqueada pelo Google

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ Favor preencher GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no arquivo .env");
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Escopo de leitura do Google Drive
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // Para receber o refresh_token
  scope: SCOPES,
  prompt: 'consent' // Força a tela de consentimento para garantir um novo refresh_token
});

console.log('🔗 Autorize este app visitando a URL abaixo:');
console.log(authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('\nInsira o código fornecido pela página: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n🟢 Códigos obtidos com sucesso!');
    console.log('----------------------------------------------------');
    console.log(`Access Token: ${tokens.access_token}`);
    console.log(`\n🌟 Refresh Token (MUITO IMPORTANTE): ${tokens.refresh_token}`);
    console.log('----------------------------------------------------');
    
    // Adicionar automaticamente ao .env se não existir
    const envPath = path.resolve(__dirname, '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
        envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/g, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
        envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ O GOOGLE_REFRESH_TOKEN foi injetado com sucesso no seu .env!');
    console.log('Você já pode rodar o scraper usando a API Oficial do Drive.');
    
  } catch (error) {
    console.error('❌ Erro ao obter tokens:', error.response ? error.response.data : error.message);
  } finally {
    rl.close();
  }
});
