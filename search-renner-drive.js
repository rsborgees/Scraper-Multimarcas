const puppeteer = require('puppeteer');
require('dotenv').config();

async function searchRenner() {
    console.log('🔍 [Debug] Buscando especificamente por "Renner" no Drive...');
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));
        
        const rennerItems = await page.evaluate(() => {
            const found = [];
            // Procurar em todos os elementos de texto
            document.querySelectorAll('div[data-id], a[href*="/file/d/"]').forEach(el => {
                const text = el.innerText || '';
                if (text.toLowerCase().includes('renner')) {
                    found.push(text.substring(0, 100));
                }
            });
            return found;
        });

        console.log(`📊 Itens "Renner" encontrados: ${rennerItems.length}`);
        rennerItems.forEach((it, i) => console.log(`  ${i+1}: ${it.replace(/\n/g, ' ')}`));

    } catch (e) {
        console.error('❌ Erro:', e.message);
    } finally {
        await browser.close();
    }
}

searchRenner();
