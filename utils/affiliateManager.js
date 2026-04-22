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
 * Gera um link parametrizado longo via Awin.
 * 
 * @param {string} originalUrl - A URL original do produto
 * @param {string} store - O nome da loja (ex: 'renner')
 * @returns {Promise<string>} - A URL parametrizada longa
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

    // Cria o link longo parametrizado
    const longTrackingUrl = `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${publisherId}&p=${encodeURIComponent(cleanUrl)}`;

    console.log(`🔗 [Awin] Parametrizando link longo para ${store.toUpperCase()} (ID: ${advertiserId})...`);
    return longTrackingUrl;
}

module.exports = {
    generateAwinLink,
    MERCHANT_IDS
};
