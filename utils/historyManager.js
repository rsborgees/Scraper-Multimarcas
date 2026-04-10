const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// Initialize if not exists
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ sent_ids: {}, format_version: 2 }));
}

function loadHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return {};
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(data);
        return parsed.sent_ids || {};
    } catch (e) {
        console.error('Erro ao carregar histórico:', e.message);
        return {};
    }
}

function saveHistory(idsObject) {
    const data = {
        sent_ids: idsObject,
        format_version: 2,
        last_update: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}

function normalizeId(id) {
    if (!id) return '';
    return id.toString().trim().toUpperCase().replace(/\..*$/, ''); // Remove extensões e espaços
}

function isSentToday(id) {
    const history = loadHistory();
    const normId = normalizeId(id);
    const entry = history[normId];
    if (!entry) return false;

    const entryDate = new Date(entry.timestamp);
    const today = new Date();

    return entryDate.getFullYear() === today.getFullYear() &&
           entryDate.getMonth() === today.getMonth() &&
           entryDate.getDate() === today.getDate();
}

function markAsSent(id, store) {
    const history = loadHistory();
    const normId = normalizeId(id);
    history[normId] = {
        timestamp: Date.now(),
        lastSent: new Date().toISOString(),
        store: store
    };
    saveHistory(history);
}

/**
 * Organiza os itens do Drive em Tiers:
 * Tier 1: Nunca enviados
 * Tier 2: Já enviados (ordenados pelo mais antigo primeiro)
 * Exclui: Enviados hoje
 */
function getSelectionPool(driveItems) {
    const history = loadHistory();
    const neverSent = [];
    const previouslySent = [];

    driveItems.forEach(item => {
        const id = typeof item === 'string' ? item : (item.id || item.fileName);
        const normId = normalizeId(id);
        
        if (isSentToday(normId)) {
            return; // Bloqueio Diário
        }

        const entry = history[normId];
        if (!entry) {
            neverSent.push(item);
        } else {
            previouslySent.push({ ...item, lastSent: entry.timestamp });
        }
    });

    // Ordena Tier 2 pelo timestamp mais antigo (Equilíbrio na reciclagem)
    previouslySent.sort((a, b) => a.lastSent - b.lastSent);

    return [...neverSent, ...previouslySent];
}

module.exports = { 
    loadHistory, 
    saveHistory, 
    normalizeId, 
    isSentToday, 
    markAsSent, 
    getSelectionPool 
};
