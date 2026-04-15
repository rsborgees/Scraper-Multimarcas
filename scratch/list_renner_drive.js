const { google } = require('googleapis');
require('dotenv').config();

async function listRennerFiles() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    try {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false and name contains 'Renner'`,
            fields: 'files(id, name, mimeType)',
            pageSize: 100
        });
        const files = response.data.files;
        if (files.length === 0) {
            console.log("Nenhum arquivo Renner encontrado.");
        } else {
            console.log("Arquivos Renner encontrados:");
            files.forEach(f => console.log(`- ${f.name} (ID: ${f.id})`));
        }
    } catch (e) {
        console.error("Erro na API do Drive:", e.message);
    }
}

listRennerFiles();
