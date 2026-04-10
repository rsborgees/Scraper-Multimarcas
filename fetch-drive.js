const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();
const { parseProductRenner } = require('./renner/parser');

(async () => {
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    console.log(`Acessando a pasta do Google Drive: ${folderId}...`);
    
    let fileNames = [];
    try {
        await page.goto(`https://drive.google.com/drive/folders/${folderId}`, { waitUntil: 'networkidle2', timeout: 60000 });
        
        await new Promise(r => setTimeout(r, 5000));
        
        fileNames = await page.evaluate(() => {
            const elements = document.querySelectorAll('div, a, span');
            const names = [];
            elements.forEach(el => {
                const text = el.innerText || el.textContent;
                if (text && (text.toLowerCase().includes('.jpg') || text.toLowerCase().includes('.png') || text.toLowerCase().includes('.jpeg') || text.match(/\d{6,}.*renner/i))) {
                    // Split em uniline se juntou vários textos
                    const lines = text.split('\n');
                    lines.forEach(line => {
                         if (line.match(/\d{6,}/)) names.push(line.trim());
                    });
                }
                const label = el.getAttribute('aria-label');
                if (label && label.match(/\d{6,}/)) {
                    names.push(label);
                }
            });
            return [...new Set(names)];
        });
        
    } catch (err) {
        console.error("Erro acessando a pasta do Drive:", err.message);
    }
    
    const fileNamesFiltered = fileNames.filter(f => f.match(/\b\d{5,}\b/));
    console.log(`Nomes brutos encontrados no Drive:`, fileNamesFiltered);
    
    const results = [];
    
    // Pega as imagens especificadas como renner, ou todas que tem ID se não tiver a palavra.
    const rennerFiles = fileNamesFiltered.filter(f => f.toLowerCase().includes('renner'));
    const filesToTest = rennerFiles.length > 0 ? rennerFiles : fileNamesFiltered;
    
    if (filesToTest.length === 0) {
         console.log("❌ Não foi possível ver os arquivos no Drive. Provavelmente a pasta é privada e requer Login/Tokens.json.");
    }

    for (const file of filesToTest.slice(0, 5)) { // Limita pra teste
        const match = file.match(/\d{6,}/); // Mínimo 6 digitos
        if (match) {
             const id = match[0];
             console.log(`Fazendo scrape do ID: ${id} (encontrado: ${file.substring(0,30)})`);
             const data = await parseProductRenner(page, id);
             if (data) {
                 results.push({ sourceInfo: file, ...data });
                 console.log(`✅ Sucesso extraindo ID ${id}`);
             } else {
                 console.log(`❌ Falha / Não encontrado ID ${id}`);
             }
        }
    }
    
    fs.writeFileSync('produtos_renner.json', JSON.stringify(results, null, 2));
    console.log(`\n✅ ${results.length} Produtos salvos em produtos_renner.json`);
    
    await browser.close();
})();
