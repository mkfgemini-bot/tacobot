/**
 * AGENTE DE IA + CHATBOT WHATSAPP
 * Backend com Express, WhatsApp Web.js, Groq AI e Socket.IO
 * QR Code aparece no navegador - sem terminal!
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const OpenAI = require("openai");
const { createSilencio } = require("./agenteq1_silencio");
const silencio = createSilencio(__dirname);

// =====================================
// CONFIGURAÇÃO
// =====================================
// Railway/produção define a porta via variável de ambiente PORT.
const PORT = process.env.PORT || 3000;
// Senha do painel (defina PAINEL_SENHA nas variáveis do Railway).
// Em ambiente local, se não definida, o painel fica aberto.
const PAINEL_SENHA = process.env.PAINEL_SENHA || "";
const CONFIG_FILE = path.join(__dirname, "config.json");

let groqClient = null;
let whatsappClient = null;
let whatsappConectado = false;
let io = null;

// Carregar ou criar config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Erro ao carregar config:", e);
  }
  const defaultConfig = {
    groqApiKey: "",
    useAI: true,
    model: "llama-3.1-8b-instant",
    promptSistema: "Você é o assistente virtual oficial da Q1 Digital, uma operação de engenharia de conversão, automação e arquitetura de ecossistemas digitais para marcas que exigem evolução rápida no ambiente online. Tom premium, tecnológico, confiante e direto. Apresente as soluções (sites profissionais, funis de venda, tráfego pago, automação com IA, gestão de redes sociais, estratégia digital e marketing completo) e conduza o contato para agendar um diagnóstico gratuito pelo WhatsApp (+55 48 99974-4624) ou e-mail contato@q1digital.com.br. Não invente preços: o investimento é definido após o diagnóstico. Se não souber algo ou pedirem um humano, peça para aguardar que um especialista da Q1 assume a conversa.",
    flows: [
      {
        id: "1",
        palavras: ["oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "menu", "início", "inicio", "começar", "comecar"],
        resposta: "Olá! 👋 Aqui é o assistente da *Q1 Digital* — engenharia de conversão, automação e presença online para marcas que exigem evolução rápida.\n\nComo posso te ajudar hoje?\n\n1️⃣ Conhecer nossas soluções\n2️⃣ Agendar diagnóstico gratuito\n3️⃣ Falar com um especialista\n4️⃣ Como funciona o Método Q1\n\nDigite o número ou me conte o desafio do seu negócio. 🚀",
      },
      {
        id: "2",
        palavras: ["1", "soluções", "solucoes", "serviços", "servicos", "o que fazem"],
        resposta: "Nossas soluções de crescimento 🚀\n\n🌐 *Criação de Sites Profissionais*\n🎯 *Funis de Venda*\n📈 *Tráfego Pago* (Meta e Google Ads)\n🤖 *Automação com IA* (vende 24h)\n📱 *Gestão de Redes Sociais*\n🧭 *Estratégia Digital* (data-driven)\n♾️ *Marketing Digital Completo* (gestão 360º)\n\nQuer um diagnóstico gratuito? Digite *2*.",
      },
      {
        id: "3",
        palavras: ["2", "diagnóstico", "diagnostico", "agendar", "orçamento", "orcamento", "preço", "preco", "valor", "quanto custa"],
        resposta: "Perfeito! O *diagnóstico é gratuito* e é o primeiro passo do Método Q1. 🔍\n\nO investimento de cada projeto é definido após essa análise, conforme o escopo do seu negócio.\n\n👉 Agende pelo WhatsApp: https://wa.me/5548999744624\n📧 Ou e-mail: contato@q1digital.com.br\n\nMe conte: qual é o principal desafio do seu negócio hoje?",
      },
      {
        id: "4",
        palavras: ["3", "atendente", "humano", "especialista"],
        resposta: "Combinado! Um especialista da *Q1 Digital* vai assumir esta conversa em breve. ⏳\n\nPara agilizar, fale direto pelo WhatsApp: https://wa.me/5548999744624",
      },
      {
        id: "5",
        palavras: ["4", "método", "metodo", "como funciona", "processo", "etapas"],
        resposta: "O *Método Q1 Digital*:\n\n*01* Diagnóstico Profundo\n*02* Arquitetura e Planejamento\n*03* Implementação Avançada\n*04* Go-to-Market e Otimização\n*05* Escala Exponencial\n\nQuer começar pelo diagnóstico gratuito? Digite *2*. 🚀",
      },
    ],
  };
  saveConfig(defaultConfig);
  return defaultConfig;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

let config = loadConfig();

// A chave Groq pode vir da variável de ambiente (recomendado em produção/Railway)
// ou do config.json (uso local pelo painel). A variável de ambiente tem prioridade.
function getGroqKey() {
  if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim()) {
    return process.env.GROQ_API_KEY.trim();
  }
  return (config.groqApiKey || "").trim();
}

// Inicializar Groq se tiver API key
function initGroq() {
  const key = getGroqKey();
  if (key) {
    groqClient = new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" });
  } else {
    groqClient = null;
  }
}
initGroq();

// =====================================
// EXPRESS + SOCKET.IO
// =====================================
const app = express();
const server = http.createServer(app);
io = new Server(server);

// =====================================
// PROTEÇÃO POR SENHA (HTTP Basic Auth)
// Ativa apenas se PAINEL_SENHA estiver definida (ex: no Railway).
// Usuário: q1  |  Senha: o valor de PAINEL_SENHA
// =====================================
const PAINEL_USUARIO = process.env.PAINEL_USUARIO || "q1";

function checarAuth(req) {
  if (!PAINEL_SENHA) return true; // sem senha definida = painel aberto (uso local)
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const [user, pass] = Buffer.from(header.slice(6), "base64").toString().split(":");
    return user === PAINEL_USUARIO && pass === PAINEL_SENHA;
  } catch (e) {
    return false;
  }
}

if (PAINEL_SENHA) {
  app.use((req, res, next) => {
    if (req.path === "/health") return next(); // health check sempre público
    if (checarAuth(req)) return next();
    res.set("WWW-Authenticate", 'Basic realm="Q1 Digital - Painel"');
    return res.status(401).send("Acesso restrito - Q1 Digital");
  });
  // Protege também a conexão do Socket.IO
  io.use((socket, next) => {
    if (checarAuth(socket.request)) return next();
    next(new Error("nao_autorizado"));
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API: Salvar config
app.post("/api/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig(config);
  initGroq();
  res.json({ ok: true });
});

// API: Obter config (sem expor a chave completa por segurança no log)
app.get("/api/config", (req, res) => {
  const safe = { ...config };
  if (safe.groqApiKey) safe.groqApiKey = safe.groqApiKey.substring(0, 8) + "***";
  res.json(safe);
});

// API: Config completa para edição (front envia só se usuário editar)
app.get("/api/config/full", (req, res) => {
  res.json(config);
});

app.get("/api/silencio-chats", (req, res) => {
  res.json({ ok: true, chats: silencio.listar() });
});
app.post("/api/silencio-chats", (req, res) => {
  const chatId = (req.body && req.body.chatId) ? String(req.body.chatId).trim() : "";
  const remover = !!(req.body && req.body.remover);
  if (!chatId) return res.status(400).json({ ok: false, erro: "chatId obrigatório" });
  if (remover) silencio.desilenciarChat(chatId);
  res.json({ ok: true, chats: silencio.listar() });
});

// Rota principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API: Desconectar WhatsApp
app.post("/api/whatsapp/disconnect", async (req, res) => {
  try {
    if (whatsappClient) {
      whatsappConectado = false;
      try { await whatsappClient.destroy(); } catch (e) {}
      whatsappClient = null;
      io.emit("status", { conectado: false, mensagem: "Desconectado. Clique em Gerar novo QR Code para conectar novamente." });
    }
    res.json({ ok: true });
  } catch (e) {
    whatsappClient = null;
    res.json({ ok: true });
  }
});

// API: Gerar novo QR Code (reinicia o WhatsApp)
// ?limpar=1 para limpar sessão e tentar do zero (quando trava)
app.post("/api/whatsapp/restart", async (req, res) => {
  try {
    if (whatsappClient) {
      try { await whatsappClient.destroy(); } catch (e) {}
      whatsappClient = null;
    }
    whatsappConectado = false;

    // Limpar sessão se solicitado (resolve "não conecta" ou travamentos)
    if (req.query.limpar === "1") {
      const authPath = path.join(__dirname, ".wwebjs_auth");
      if (fs.existsSync(authPath)) {
        try {
          fs.rmSync(authPath, { recursive: true });
          console.log("Sessão limpa. Iniciando do zero.");
        } catch (e) {
          console.error("Erro ao limpar sessão:", e);
        }
      }
    }

    io.emit("qr", "loading");
    io.emit("status", { conectado: false, mensagem: "Gerando QR Code... Pode levar 1-2 minutos na primeira vez." });
    initWhatsApp(true);
    res.json({ ok: true });
  } catch (e) {
    console.error("Erro ao reiniciar:", e);
    io.emit("status", { conectado: false, mensagem: "Erro. Clique em 'Limpar sessão e tentar' para recomeçar." });
    res.json({ ok: false, erro: e.message });
  }
});

// =====================================
// WHATSAPP
// =====================================
function initWhatsApp(force = false) {
  if (whatsappClient && !force) return;
  if (whatsappClient && force) {
    whatsappClient = null;
  }
  
  whatsappClient = new Client({
    authStrategy: new LocalAuth({ clientId: "agente-ia" }),
    authTimeoutMs: 180000, // 3 min para escanear (evita timeout ao conectar)
    puppeteer: {
      headless: true,
      timeout: 120000, // 2 min para o navegador iniciar
      // Em produção (Railway/Docker) usamos o Chromium do sistema, se disponível.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--no-first-run",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=VizDisplayCompositor",
        "--single-process",
      ],
    },
  });

  whatsappClient.on("qr", async (qr) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300 });
      io.emit("qr", qrDataUrl);
      io.emit("status", { conectado: false, mensagem: "Escaneie o QR Code com seu WhatsApp" });
    } catch (e) {
      console.error("Erro ao gerar QR:", e);
    }
  });

  whatsappClient.on("ready", () => {
    whatsappConectado = true;
    io.emit("qr", null); // limpa QR
    io.emit("status", { conectado: true, mensagem: "WhatsApp conectado!" });
    console.log("✅ WhatsApp conectado.");
  });

  whatsappClient.on("disconnected", (motivo) => {
    whatsappConectado = false;
    io.emit("status", { conectado: false, mensagem: "WhatsApp desconectado. Tentando reconectar..." });
    console.warn("⚠️ WhatsApp desconectado:", motivo, "- tentando reconectar em 5s");
    // Reconexão automática para operação 24/7
    setTimeout(() => {
      try {
        whatsappClient = null;
        initWhatsApp(true);
      } catch (e) {
        console.error("Erro ao reconectar:", e.message);
      }
    }, 5000);
  });

  whatsappClient.on("auth_failure", (msg) => {
    console.error("Falha na autenticação:", msg);
    io.emit("status", { conectado: false, mensagem: "Falha ao conectar. Clique em 'Limpar sessão e tentar'." });
  });

  whatsappClient.on("message", handleMessage);

  whatsappClient.initialize().catch((err) => {
    console.error("Erro ao inicializar WhatsApp:", err);
    whatsappClient = null;
    io.emit("status", { conectado: false, mensagem: "Erro ao iniciar. Feche outros programas e clique em 'Limpar sessão e tentar'." });
  });
}

// =====================================
// LÓGICA DE MENSAGENS
// =====================================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ----- Memória de conversa por contato (curto prazo, em memória) -----
const HISTORICO_MAX = 10; // últimas 10 trocas (usuário + bot)
const memoria = new Map(); // chatId -> [{ role, content }]

function getHistorico(chatId) {
  return memoria.get(chatId) || [];
}
function pushHistorico(chatId, role, content) {
  if (!content) return;
  const hist = memoria.get(chatId) || [];
  hist.push({ role, content });
  while (hist.length > HISTORICO_MAX * 2) hist.shift();
  memoria.set(chatId, hist);
}
function limparHistorico(chatId) {
  memoria.delete(chatId);
}

// ----- Transcrição de áudio com Groq Whisper -----
async function transcreverAudio(media) {
  if (!groqClient) return null;
  try {
    const ext = (media.mimetype || "audio/ogg").split("/")[1].split(";")[0] || "ogg";
    const tmpFile = path.join(os.tmpdir(), `q1_audio_${Date.now()}.${ext}`);
    fs.writeFileSync(tmpFile, Buffer.from(media.data, "base64"));
    const resp = await groqClient.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-large-v3-turbo",
      language: "pt",
    });
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    return (resp && resp.text) ? resp.text.trim() : null;
  } catch (e) {
    console.error("Erro ao transcrever áudio:", e.message);
    return null;
  }
}

// ----- Texto para áudio (TTS) opcional, via Groq -----
async function gerarAudioTTS(texto) {
  if (!groqClient || !texto) return null;
  try {
    const resp = await groqClient.audio.speech.create({
      model: "playai-tts",
      voice: "Celeste-PlayAI",
      input: texto.slice(0, 900),
      response_format: "mp3",
    });
    const buffer = Buffer.from(await resp.arrayBuffer());
    return buffer.toString("base64");
  } catch (e) {
    console.error("Erro TTS:", e.message);
    return null;
  }
}

// ----- Busca de fluxo por palavra-chave (retorna o fluxo inteiro) -----
async function respostaPorFluxo(texto) {
  config = loadConfig();
  const txt = texto.trim().toLowerCase();
  for (const flow of config.flows || []) {
    for (const p of flow.palavras || []) {
      if (txt.includes(p.toLowerCase()) || txt === p.toLowerCase()) {
        return flow;
      }
    }
  }
  return null;
}

// ----- Resposta da IA com memória de conversa -----
async function respostaPorIA(texto, chatId) {
  if (!groqClient || !getGroqKey()) return null;
  try {
    const historico = chatId ? getHistorico(chatId) : [];
    const completion = await groqClient.chat.completions.create({
      model: config.model || "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: config.promptSistema || "Você é um assistente prestativo." },
        ...historico,
        { role: "user", content: texto },
      ],
      max_tokens: 600,
      temperature: 0.7,
    });
    const res = completion.choices?.[0]?.message?.content;
    return res ? res.trim() : null;
  } catch (e) {
    console.error("Erro Groq:", e.message);
    return null;
  }
}

// ----- Envia resposta podendo conter mídia (imagem/áudio) anexada ao fluxo -----
async function enviarResposta(msg, chat, fluxoOuTexto) {
  let texto = "";
  let midia = null; // { tipo: 'imagem'|'audio', url }

  if (typeof fluxoOuTexto === "string") {
    texto = fluxoOuTexto;
  } else if (fluxoOuTexto && typeof fluxoOuTexto === "object") {
    texto = fluxoOuTexto.resposta || "";
    if (fluxoOuTexto.midiaUrl) {
      midia = { tipo: fluxoOuTexto.midiaTipo || "imagem", url: fluxoOuTexto.midiaUrl };
    }
  }

  // Mídia anexada ao fluxo
  if (midia && midia.url) {
    try {
      const media = await MessageMedia.fromUrl(midia.url, { unsafeMime: true });
      const opcoes = {};
      if (midia.tipo === "audio") opcoes.sendAudioAsVoice = true;
      if (texto && midia.tipo === "imagem") opcoes.caption = texto;
      const enviado = await chat.sendMessage(media, opcoes);
      silencio.registrarMensagemDoBot(enviado);
      if (texto && midia.tipo === "audio") {
        const r2 = await msg.reply(texto);
        silencio.registrarMensagemDoBot(r2);
      }
      return texto;
    } catch (e) {
      console.error("Erro ao enviar mídia do fluxo:", e.message);
    }
  }

  // Texto
  const r = await msg.reply(texto);
  silencio.registrarMensagemDoBot(r);

  // Áudio (TTS) se ligado na config
  if (config.responderComAudio && texto) {
    const audioB64 = await gerarAudioTTS(texto);
    if (audioB64) {
      try {
        const media = new MessageMedia("audio/mp3", audioB64, "resposta.mp3");
        const enviado = await chat.sendMessage(media, { sendAudioAsVoice: true });
        silencio.registrarMensagemDoBot(enviado);
      } catch (e) {
        console.error("Erro ao enviar áudio TTS:", e.message);
      }
    }
  }
  return texto;
}

async function handleMessage(msg) {
  try {
    config = loadConfig();
    const from = (msg.from || "").toString();
    if (from.includes("status") || from.includes("broadcast") || msg.broadcast || msg.isStatus) return;
    if (!msg.from || msg.from.endsWith("@g.us")) return;
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const chatId = chat.id._serialized;

    if (msg.fromMe) {
      if (silencio.ehMensagemDoBot(msg)) return;
      silencio.silenciarChat(chatId);
      return;
    }

    if (config.humanoAtendeu) return;
    if (silencio.estaSilenciado(chatId)) return;

    const MAX_IDADE_SEGUNDOS = 300;
    const agora = Math.floor(Date.now() / 1000);
    const ts = msg.timestamp || 0;
    if (ts > 0 && (agora - ts) > MAX_IDADE_SEGUNDOS) return;

    // ----- Entrada: texto, áudio ou imagem -----
    let texto = msg.body ? msg.body.trim() : "";
    let tipoEntrada = "texto";

    if (msg.hasMedia && (msg.type === "ptt" || msg.type === "audio")) {
      tipoEntrada = "audio";
      try {
        await chat.sendStateRecording();
        const media = await msg.downloadMedia();
        const transcricao = media ? await transcreverAudio(media) : null;
        if (transcricao) {
          texto = transcricao;
          console.log("🎧 Áudio transcrito:", texto);
        } else {
          const r = await msg.reply("Recebi seu áudio! 🎧 Não consegui ouvir direitinho agora. Pode me escrever ou tentar de novo?");
          silencio.registrarMensagemDoBot(r);
          return;
        }
      } catch (e) {
        console.error("Erro ao processar áudio:", e.message);
        return;
      }
    } else if (msg.hasMedia && (msg.type === "image" || msg.type === "sticker")) {
      tipoEntrada = "imagem";
      const legenda = texto;
      texto = legenda
        ? `O cliente enviou uma imagem com a legenda: "${legenda}". Responda de forma útil e convide para um diagnóstico gratuito se fizer sentido.`
        : "O cliente enviou uma imagem (sem legenda). Agradeça, diga que um especialista da Q1 vai analisar o material e pergunte como pode ajudar.";
    }

    // Opt-out / pausa (apenas texto)
    if (tipoEntrada === "texto" && silencio.textoEhOptOut(texto)) {
      silencio.silenciarChat(chatId);
      limparHistorico(chatId);
      const r = await msg.reply("Ok! Pausamos o assistente automático da Q1 Digital nesta conversa. Quando precisar, é só chamar que retomamos. 🚀");
      silencio.registrarMensagemDoBot(r);
      return;
    }
    if (!texto) return;

    const typing = async () => {
      await delay(700);
      await chat.sendStateTyping();
      await delay(1100);
    };

    config = loadConfig();

    // 1) Fluxo por palavra-chave (só para texto puro)
    const fluxo = (tipoEntrada === "texto") ? await respostaPorFluxo(texto) : null;
    let respostaFinal = null;

    if (fluxo) {
      await typing();
      respostaFinal = await enviarResposta(msg, chat, fluxo);
    } else if (config.useAI) {
      // 2) IA com memória
      const respIA = await respostaPorIA(texto, chatId);
      if (respIA) {
        await typing();
        respostaFinal = await enviarResposta(msg, chat, respIA);
      }
    }

    // 3) Fallback
    if (!respostaFinal) {
      await typing();
      respostaFinal = await enviarResposta(
        msg, chat,
        "Não captei bem sua mensagem. 🤔\n\nDigite *menu* para ver as opções da Q1 Digital ou me conte o desafio do seu negócio que eu te oriento."
      );
    }

    // Atualiza memória da conversa
    pushHistorico(chatId, "user", texto);
    pushHistorico(chatId, "assistant", respostaFinal);
  } catch (error) {
    console.error("❌ Erro ao processar mensagem:", error);
    try {
      const r = await msg.reply("Tivemos uma instabilidade momentânea. Tente novamente em instantes. 🙏");
      silencio.registrarMensagemDoBot(r);
    } catch (e) {}
  }
}

// =====================================
// SOCKET.IO - broadcast de status
// =====================================
io.on("connection", (socket) => {
  socket.emit("status", {
    conectado: whatsappConectado,
    mensagem: whatsappConectado ? "WhatsApp conectado!" : "Conecte escaneando o QR Code",
  });
  if (!whatsappConectado) {
    socket.emit("qr", "loading");
  }
});

// =====================================
// OPERAÇÃO 24/7 - resiliência
// =====================================
// Health check (Railway/monitoramento)
app.get("/health", (req, res) => {
  res.json({ ok: true, whatsapp: whatsappConectado, uptime: process.uptime() });
});

// Evita que erros não tratados derrubem o processo (mantém o bot no ar)
process.on("uncaughtException", (err) => {
  console.error("⚠️ uncaughtException (ignorado para manter 24/7):", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ unhandledRejection (ignorado para manter 24/7):", reason);
});

// =====================================
// INICIAR
// =====================================
  server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  Q1 DIGITAL · PAINEL DO ASSISTENTE DE IA (WHATSAPP)      ║
║                                                          ║
║  Abra no navegador:  http://localhost:${PORT}             ║
║                                                          ║
║  O QR Code aparecerá na tela - escaneie com o WhatsApp!  ║
╚══════════════════════════════════════════════════════════╝
  `);
  io.emit("qr", "loading");
  initWhatsApp();
});
