/**
 * setup-quota-table.js
 *
 * Cria e popula a tabela `quota_config` no Supabase.
 * Execute: node setup-quota-table.js
 */

'use strict';

const https = require('https');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados no .env');
    process.exit(1);
}

const hostname = new URL(SUPABASE_URL).hostname;

function supabaseRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const bodyStr = body ? JSON.stringify(body) : null;
        const options = {
            hostname,
            port: 443,
            path: '/rest/v1' + path,
            method,
            headers: {
                'apikey':        SERVICE_KEY,
                'Authorization': 'Bearer ' + SERVICE_KEY,
                'Content-Type':  'application/json',
                'Prefer':        'return=representation'
            }
        };
        if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });

        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

const INITIAL_DATA = [
    { loja: 'renner',    meta_diaria: 45, ativo: true },
    { loja: 'cea',       meta_diaria: 10, ativo: true },
    { loja: 'riachuelo', meta_diaria: 15, ativo: true }
];

async function main() {
    console.log('🔧 [Setup] Verificando tabela quota_config no Supabase...\n');

    // 1. Tenta ler a tabela
    const check = await supabaseRequest('GET', '/quota_config?select=loja,meta_diaria,ativo&limit=10');

    if (check.status === 200) {
        const rows = JSON.parse(check.data);
        console.log(`✅ Tabela quota_config já existe com ${rows.length} linha(s):`);
        if (rows.length > 0) {
            console.table(rows);
        }

        if (rows.length === 0) {
            // Tabela existe mas está vazia — insere os dados iniciais
            console.log('\n📥 Inserindo dados iniciais...');
            await insertInitialData();
        } else {
            console.log('\n✅ Setup completo! A cliente pode editar os valores diretamente no Supabase.');
        }

    } else {
        // Tabela não existe ou outro erro
        let errMsg = check.data;
        try { errMsg = JSON.parse(check.data).message || errMsg; } catch {}

        console.error(`❌ Tabela quota_config não encontrada (HTTP ${check.status}): ${errMsg}`);
        console.log('\n📋 Execute o SQL abaixo no Supabase SQL Editor para criar a tabela:');
        console.log('   👉 https://supabase.com/dashboard/project/' + hostname.split('.')[0] + '/sql/new\n');
        console.log('─'.repeat(60));
        console.log(`
CREATE TABLE IF NOT EXISTS quota_config (
  loja        TEXT PRIMARY KEY,
  meta_diaria INTEGER NOT NULL DEFAULT 0,
  ativo       BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO quota_config (loja, meta_diaria, ativo) VALUES
  ('renner',    45, true),
  ('cea',       10, true),
  ('riachuelo', 15, true)
ON CONFLICT (loja) DO NOTHING;
`);
        console.log('─'.repeat(60));
        console.log('\nDepois de criar a tabela, execute novamente: node setup-quota-table.js');
        process.exit(1);
    }
}

async function insertInitialData() {
    const result = await supabaseRequest('POST', '/quota_config', INITIAL_DATA);
    if (result.status === 201 || result.status === 200) {
        const rows = JSON.parse(result.data);
        console.log('✅ Dados iniciais inseridos:');
        console.table(rows);
    } else {
        console.error(`❌ Erro ao inserir dados (HTTP ${result.status}):`, result.data);
    }
}

main().catch(e => {
    console.error('❌ Erro inesperado:', e.message);
    process.exit(1);
});
