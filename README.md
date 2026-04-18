# Scraper Multimarcas 2.0

Este projeto é um web scraper automatizado desenvolvido em Node.js usando o Puppeteer. O principal objetivo é extrair dados de produtos de moda de lojas parceiras (Renner, Riachuelo, C&A) de forma inteligente e orquestrar o envio das informações contendo links de afiliados.

## Funcionalidades

- **Web Scraping Dinâmico:** Utiliza o Puppeteer para navegar pelas páginas de produtos e extrair dados cruciais como preço original, preço em promoção, tamanhos em estoque, imagens e meta-dados de categorias (vestido, calça, acessório, etc.).
- **Integração com o Google Drive:** Recupera uma lista de prioridades de arquivos armazenados no Drive usando a Google Drive API. A aplicação lê dinamicamente SKUs nos nomes dos arquivos, e também entende marcações de uso de tamanho.
- **Parametrização e Afiliados:** Integração com a Awin para gerar automaticamente links curtos patrocinados (`tidd.ly` e semelhantes) visando conversão direta.
- **Orquestração e Agendamento:** Controle de quotas e postagens através do `orchestrator.js` e do `cronScheduler.js`, gerenciando o volume de alertas.
- **Webhooks:** Envia mensagens pré-formatadas, com a precificação correta formatada localmente, prontas para redes como Telegram e WhatsApp.

## Tecnologias e Ferramentas

- **Node.js**
- **Puppeteer** (Navegação Headless e Scraping do DOM)
- **Google APIs (googleapis)** (Listagem e integração com o Drive)
- **Axios** (Integrações webhook e APIs HTTP)
- **node-cron** (Job scheduling)
- **dotenv** (Gerenciamento de variáveis de ambiente)

## Como utilizar e executar

1. **Instalação das dependências:**
   Execute o comando na raiz do projeto:
   ```bash
   npm install
   ```

2. **Configuração de Ambiente:**
   Crie ou edite o arquivo `.env` na raiz do repositório incluindo os tokens de API para Awin, credenciais do Google Drive OAuth, e URL dos webhooks configuráveis.

3. **Geração de Tokens:**
   Se for seu primeiro uso com o Google Drive, execute a geração/verificação de token:
   ```bash
   node generate-token.js
   ```

4. **Schedules:**
   Você pode rodar o scheduler mestre contínuo:
   ```bash
   npm start
   ```

   Ou forçar uma orquestração avulsa:
   ```bash
   npm run orchestrate
   ```

## Estrutura do Projeto

- `/cea/`, `/renner/`, `/riachuelo/`: Lógica e parsers específicos de DOM ou endpoints ocultos para as respectivas lojas.
- `/utils/`: Controles genéricos de histórico, formatador de mensagens, afiliador (Awin), e algoritmos de escalonamento.
- `orchestrator.js`: Controle de execução geral da máquina de estados, priorização partindo do Drive.
- `cronScheduler.js`: Agenda tarefas sistêmicas em paralelo de monitoramento e envios.
