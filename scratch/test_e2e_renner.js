const puppeteer = require('puppeteer');
const { parseProductRenner } = require('../renner/parser');
const { formatRennerMessage } = require('../utils/messageFormatter');

(async () => {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox'] 
    });
    const page = await browser.newPage();
    
    // URLs reais para teste
    const testUrls = [
        "https://www.lojasrenner.com.br/p/vestido-midi-em-viscose-com-alcas-finas-e-abotoamento-frontal/-/A-928956973-br.lr?sku=928957010",
        "https://www.lojasrenner.com.br/p/blusa-em-ponto-roma-com-gola-redonda-e-manga-curta/-/A-928952403-br.lr?sku=928952411"
    ];

    try {
        console.log("Iniciando teste de extração + formatação...");
        
        for (const url of testUrls) {
            console.log(`\n--- Testando Produto URL: ${url} ---`);
            const result = await parseProductRenner(page, url);
            if (result) {
                console.log("Dados extraídos:");
                console.log(`- Nome: ${result.nome}`);
                console.log(`- Preço Original: ${result.precoOriginal}`);
                console.log(`- Preço Atual: ${result.precoAtual}`);
                console.log(`- Desconto: ${result.precoOriginal > result.precoAtual ? 'SIM' : 'NÃO'}`);
                
                console.log("\nMensagem Formatada:");
                console.log(formatRennerMessage(result));
            } else {
                console.log("Falha ao extrair produto.");
            }
            console.log("-".repeat(40));
        }
    } catch (err) {
        console.error("Erro no teste:", err);
    } finally {
        await browser.close();
    }
})();
