const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

const skusToFix = ['930625445', '930847582', '930754968'];
const items = [
      {
        "id": "930625445",
        "nome": "Vestido Longo Em Piquet Com Cinto Corda E Fenda Frontal Vinho",
        "precoAtual": 199.9,
        "precoOriginal": 199.9,
        "tamanhos": ["M"],
        "categoria": "vestido",
        "url": "https://tidd.ly/4dHIFbI",
        "imageUrl": null,
        "message": "*RENNER*\nㅤ\n🏷️ Cupom *FRANCALHEIRA*\n(ativo clicando pelos meus links) \n\nVestido Longo Em Piquet Com Cinto Corda E Fenda Frontal Vinho\nTamanhos disponíveis: M\nDe ~R$ 199,90~ por *R$ 199,90*\n\n🔗 https://tidd.ly/4dHIFbI\n\nVagas para nossa Comunidade: \n(chama as amigas) 👇🏼\n\nhttps://chat.whatsapp.com/BvwDGxSyny67OV0loLpS9p",
        "store": "renner"
      },
      {
        "id": "930847582",
        "nome": "Vestido Midi Manga Longa Em Tule Estampado Com Efeito Manchado Marrom",
        "precoAtual": 179.9,
        "precoOriginal": 179.9,
        "tamanhos": ["PP"],
        "categoria": "vestido",
        "url": "https://tidd.ly/4mA9hOo",
        "imageUrl": null,
        "message": "*RENNER*\nㅤ\n🏷️ Cupom *FRANCALHEIRA*\n(ativo clicando pelos meus links) \n\nVestido Midi Manga Longa Em Tule Estampado Com Efeito Manchado Marrom\nTamanhos disponíveis: PP\nDe ~R$ 179,90~ por *R$ 179,90*\n\n🔗 https://tidd.ly/4mA9hOo\n\nVagas para nossa Comunidade: \n(chama as amigas) 👇🏼\n\nhttps://chat.whatsapp.com/BvwDGxSyny67OV0loLpS9p",
        "store": "renner"
      },
      {
        "id": "930754968",
        "nome": "Vestido Manga Longa Com Drapeado Frontal Marrom",
        "precoAtual": 199.9,
        "precoOriginal": 199.9,
        "tamanhos": ["G"],
        "categoria": "vestido",
        "url": "https://tidd.ly/4clOARh",
        "imageUrl": null,
        "message": "*RENNER*\nㅤ\n🏷️ Cupom *FRANCALHEIRA*\n(ativo clicando pelos meus links) \n\nVestido Manga Longa Com Drapeado Frontal Marrom\nTamanhos disponíveis: G\nDe ~R$ 199,90~ por *R$ 199,90*\n\n🔗 https://tidd.ly/4clOARh\n\nVagas para nossa Comunidade: \n(chama as amigas) 👇🏼\n\nhttps://chat.whatsapp.com/BvwDGxSyny67OV0loLpS9p",
        "store": "renner"
      }
];

async function run() {
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const item of items) {
        let driveId = null;
        console.log(`Buscando ID do arquivo no Drive para o SKU: ${item.id}`);
        try {
            await page.goto(`https://drive.google.com/drive/search?q=${item.id}`, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(r => setTimeout(r, 4000));
            
            driveId = await page.evaluate(() => {
                let id = null;
                document.querySelectorAll('div[data-id]').forEach(el => {
                    if (el.getAttribute('data-id').length > 20) {
                        id = el.getAttribute('data-id');
                    }
                });
                return id;
            });
            
            if (driveId) {
                console.log(`Encontrado! ${driveId}`);
                item.imageUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
            } else {
                console.log("Não encontrado via search box.");
                // Tentando varredura bruta no folder
                await page.goto(`https://drive.google.com/drive/folders/${process.env.GOOGLE_DRIVE_FOLDER_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(r => setTimeout(r, 4000));
                
                // scroll down 5 times
                for(let i=0;i<5;i++){
                    await page.evaluate(() => window.scrollBy(0, 2000));
                    await new Promise(r => setTimeout(r, 1000));
                }
                
                driveId = await page.evaluate((sku) => {
                    let id = null;
                    document.querySelectorAll('*').forEach(el => {
                        if (el.children.length === 0 && (el.innerText || '').includes(sku)) {
                             let parent = el;
                             while(parent && parent !== document.body) {
                                  if (parent.hasAttribute('data-id') && parent.getAttribute('data-id').length > 20) {
                                      id = parent.getAttribute('data-id');
                                      break;
                                  }
                                  parent = parent.parentElement;
                             }
                        }
                    });
                    return id;
                }, item.id);

                if (driveId) {
                    console.log(`Encontrado via full list! ${driveId}`);
                    item.imageUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
                } else {
                    console.log(`Definitivamente não encontrado para ${item.id}`);
                }
            }
        } catch (e) {
            console.error(e.message);
        }
    }

    await browser.close();

    console.log("Enviando para o Webhook com as imagens atualizadas...");
    try {
        const response = await axios.post(process.env.WEBHOOK_URL, items);
        console.log(`Webhook retornou: ${response.status}`);
    } catch (e) {
         console.error('Erro ao enviar:', e.message);
    }
}

run();
