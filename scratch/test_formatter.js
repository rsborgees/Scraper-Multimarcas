const { formatRennerMessage } = require('../utils/messageFormatter');

const testCases = [
    {
        name: "Promoção Real",
        product: {
            nome: "Vestido Teste",
            precoOriginal: 199.90,
            precoAtual: 99.90,
            tamanhos: ["P", "M", "G"],
            url: "https://example.com/p1"
        }
    },
    {
        name: "Sem Promoção (Preços Iguais)",
        product: {
            nome: "Blusa Teste",
            precoOriginal: 59.90,
            precoAtual: 59.90,
            tamanhos: ["M"],
            url: "https://example.com/p2"
        }
    },
    {
        name: "Sem Preço Atual (Bug reportado)",
        product: {
            nome: "Calça Teste",
            precoOriginal: 159.90,
            precoAtual: null,
            tamanhos: ["40", "42"],
            url: "https://example.com/p3"
        }
    },
    {
        name: "Sem Preço Nenhum",
        product: {
            nome: "Acessório Teste",
            precoOriginal: null,
            precoAtual: null,
            tamanhos: ["U"],
            url: "https://example.com/p4"
        }
    },
    {
        name: "Apenas Preço Atual",
        product: {
            nome: "Saia Teste",
            precoOriginal: null,
            precoAtual: 79.90,
            tamanhos: ["G"],
            url: "https://example.com/p5"
        }
    }
];

console.log("=== TESTANDO FORMATAÇÃO ATUAL ===\n");
testCases.forEach(tc => {
    console.log(`CASE: ${tc.name}`);
    try {
        console.log(formatRennerMessage(tc.product));
    } catch (e) {
        console.log(`ERRO: ${e.message}`);
    }
    console.log("\n" + "-".repeat(30) + "\n");
});
