/**
 * Gerenciador de links de afiliados Awin
 * Realiza a parametrização e o encurtamento (tidd.ly) via API.
 */

const MERCHANT_IDS = {
    'renner': '17801',
    'riachuelo': '86587'
};

const PUBLISHER_IDS = {
    'riachuelo': process.env.AWIN_PUBLISHER_ID_RIACHUELO
};

/**
 * Gera um link parametrizado e encurtado via API da Awin.
 * Se a API falhar, retorna o link longo parametrizado como fallback.
 * 
 * @param {string} originalUrl - A URL original do produto
 * @param {string} store - O nome da loja (ex: 'renner')
 * @returns {Promise<string>} - A URL encurtada ou a melhor disponível
 */
async function generateAwinLink(originalUrl, store) {
    const storeLower = store.toLowerCase();
    
    // Agora processamos tanto Renner quanto Riachuelo
    if (!MERCHANT_IDS[storeLower]) {
        console.log(`ℹ️ [Awin] Ignorando parametrização para ${store} (Loja não configurada na Awin).`);
        return originalUrl;
    }

    const publisherId = PUBLISHER_IDS[storeLower] || process.env.AWIN_PUBLISHER_ID;
    const apiToken = process.env.AWIN_API_TOKEN;
    const advertiserId = MERCHANT_IDS[storeLower];

    if (!publisherId) {
        console.warn('⚠️ [Awin] AWIN_PUBLISHER_ID não configurado.');
        return originalUrl;
    }

    // Limpa a URL de parâmetros que podem quebrar o redirecionamento
    const cleanUrl = originalUrl.split('?')[0];

    // Fallback: Gerar link longo se não houver token de API
    const longTrackingUrl = `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${publisherId}&p=${encodeURIComponent(cleanUrl)}`;

    if (!apiToken) {
        console.warn('⚠️ [Awin] AWIN_API_TOKEN não configurado. Retornando link longo.');
        return longTrackingUrl;
    }

    const MAX_ATTEMPTS = 2;
    let attempts = 0;

    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
            if (attempts > 1) {
                console.log(`🔄 [Awin] Tentativa ${attempts}/${MAX_ATTEMPTS}...`);
            } else {
                console.log(`🔗 [Awin] Encurtando link para ${store.toUpperCase()} (ID: ${advertiserId})...`);
            }
            
            const response = await fetch(`https://api.awin.com/publishers/${publisherId}/linkbuilder/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    advertiserId: parseInt(advertiserId),
                    destinationUrl: originalUrl,
                    shorten: true
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.description || `Status ${response.status}`;
                
                // Se for um erro do servidor ou o "Unknown error", tentamos novamente
                if (response.status >= 500 || errorMsg.includes('Unknown error')) {
                    if (attempts < MAX_ATTEMPTS) {
                        await new Promise(r => setTimeout(r, 1000 * attempts)); // Espera exponencial simples
                        continue;
                    }
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            
            if (data.shortUrl) {
                console.log(`✅ [Awin] Link encurtado: ${data.shortUrl}`);
                return data.shortUrl;
            }

            return data.url || longTrackingUrl;

        } catch (error) {
            if (attempts >= MAX_ATTEMPTS) {
                console.error(`❌ [Awin] Falha após ${MAX_ATTEMPTS} tentativas: ${error.message}. Usando link longo.`);
                return longTrackingUrl;
            }
            console.warn(`⚠️ [Awin] Falha na tentativa ${attempts}: ${error.message}`);
            await new Promise(r => setTimeout(r, 1000 * attempts));
        }
    }

    return longTrackingUrl;
}

module.exports = {
    generateAwinLink,
    MERCHANT_IDS
};
