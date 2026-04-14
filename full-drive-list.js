const puppeteer = require('puppeteer');
require('dotenv').config();

async function fullListDrive() {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    console.log(`🔍 [Dump] Acessando Drive: ${url}`);
    
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 10000));

        // Scroll multiple times to trigger lazy loading
        for (let i = 0; i < 10; i++) {
            await page.evaluate(() => window.scrollBy(0, 1000));
            await new Promise(r => setTimeout(r, 2000));
        }

        const files = await page.evaluate(() => {
            const results = [];
            // Google Drive uses various structures for file names
            document.querySelectorAll('div[data-id]').forEach(el => {
                const text = el.innerText || '';
                const id = el.getAttribute('data-id');
                if (id && id.length > 20) {
                    results.push({ name: text.split('\n')[0], id });
                }
            });
            return results;
        });

        console.log(`📊 Total de arquivos detectados: ${files.length}`);
        files.forEach((f, i) => console.log(`${i+1}: [${f.id}] ${f.name}`));

        // Also take a screenshot to be sure
        await page.screenshot({ path: 'drive_full_list.png', fullPage: true });

    } catch (e) {
        console.error("💥 Erro:", e.message);
    } finally {
        await browser.close();
    }
}

fullListDrive();
