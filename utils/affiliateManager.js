/**
 * Gerenciador de links de afiliados Awin
 * Realiza a parametrização e o encurtamento (tidd.ly) via API.
 */

const MERCHANT_IDS = {
    'renner': '17801'
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
    
    // RESTRICÃO: Só processa a Renner por enquanto
    if (storeLower !== 'renner') {
        console.log(`ℹ️ [Awin] Ignorando parametrização para ${store} (Apenas Renner ativa).`);
        return originalUrl;
    }

    const publisherId = process.env.AWIN_PUBLISHER_ID;
    const apiToken = process.env.AWIN_API_TOKEN;
    const advertiserId = MERCHANT_IDS[storeLower];

    if (!publisherId) {
        console.warn('⚠️ [Awin] AWIN_PUBLISHER_ID não configurado.');
        return originalUrl;
    }

    // Fallback: Gerar link longo se não houver token de API
    const longTrackingUrl = `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${publisherId}&p=${encodeURIComponent(originalUrl)}`;

    if (!apiToken) {
        console.warn('⚠️ [Awin] AWIN_API_TOKEN não configurado. Retornando link longo.');
        return longTrackingUrl;
    }

    try {
        console.log(`🔗 [Awin] Encurtando link para Renner (ID: ${advertiserId})...`);
        
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
            throw new Error(errorData.description || `Status ${response.status}`);
        }

        const data = await response.json();
        
        if (data.shortUrl) {
            console.log(`✅ [Awin] Link encurtado: ${data.shortUrl}`);
            return data.shortUrl;
        }

        return data.url || longTrackingUrl;

    } catch (error) {
        console.error(`❌ [Awin] Erro na API: ${error.message}. Usando link longo.`);
        return longTrackingUrl;
    }
}

module.exports = {
    generateAwinLink,
    MERCHANT_IDS
};
