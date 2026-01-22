// @ts-nocheck

// ===============================
// 🔑 CONFIGURAÇÕES (TESTE)
// ===============================
const GEMINI_API_KEY = "AIzaSyC3D1xAI600xuzlCFiJvqErfZo3xxukT3o";
const WEBHOOK_URL = "https://chat.googleapis.com/v1/spaces/AAQA-xY7kI4/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=oCpDY9CshPeSYCJtHZw_-IpTE7rTt6tZxLRJeONQ3FA";
const FEED_URL = "https://feeds.feedburner.com/GoogleAppsUpdates";

// ===============================
// 🚀 FUNÇÃO PRINCIPAL
// ===============================
function processNewsWithGemini() {
  try {
    const response = UrlFetchApp.fetch(FEED_URL);
    const xml = response.getContentText();

    const document = XmlService.parse(xml);
    const root = document.getRootElement();
    const ns = root.getNamespace();

    let items = [];
    let isAtom = false;

    if (root.getName() === "rss" || root.getChild("channel", ns)) {
      const channel = root.getChild("channel", ns) || root.getChild("channel");
      items = channel.getChildren("item", ns);
      if (!items.length) items = channel.getChildren("item");
    } else if (root.getName() === "feed") {
      isAtom = true;
      items = root.getChildren("entry", ns);
    }

    if (!items.length) {
      Logger.log("⚠️ Nenhum item encontrado");
      return;
    }

    const item = items[0];

    // ---------- TITLE ----------
    const title = item.getChild("title", ns)?.getText() || "";

    // ---------- DESCRIPTION ----------
    let rawDescription = "";
    if (isAtom) {
      rawDescription =
        item.getChild("summary", ns)?.getText() ||
        item.getChild("content", ns)?.getText() ||
        "";
    } else {
      rawDescription = item.getChild("description", ns)?.getText() || "";
    }

    const descriptionClean = limitText(
      cleanHtml(rawDescription),
      900
    );

    // ---------- LINK ----------
    let link = "";
    if (isAtom) {
      const links = item.getChildren("link", ns);
      for (let l of links) {
        const rel = l.getAttribute("rel");
        if (!rel || rel.getValue() === "alternate") {
          link = l.getAttribute("href").getValue();
          break;
        }
      }
    } else {
      link = item.getChild("link", ns)?.getText() || "";
    }

    // ---------- CACHE ----------
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty("LAST_LINK") === link) {
      Logger.log("🔁 Notícia já enviada");
      return;
    }

    // ---------- DATA + CATEGORIA ----------
    const postDate = formatPostDate(item, ns, isAtom);
    const category = detectCategory(title, descriptionClean);

    // ---------- TRADUÇÃO (COM FALLBACK) ----------
    const translated = translateWithFallback(title, descriptionClean);

    // ---------- PAYLOAD NEWSLETTER ----------
    const payload = {
      text:
        `📰 *Google Workspace — Boletim de Atualizações*\n\n` +
        `${category.emoji} *${category.label}*` +
        (postDate ? `  |  📅 ${postDate}\n\n` : `\n\n`) +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🆕 *${translated.title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        (translated.description
          ? `${translated.description}\n\n`
          : "") +
        `📌 *Leia sobre:*\n` +
        `🔗 ${link}`
    };

    UrlFetchApp.fetch(WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload)
    });

    props.setProperty("LAST_LINK", link);
    Logger.log("✅ Newsletter enviada com sucesso");

  } catch (e) {
    Logger.log("❌ Erro fatal: " + e.toString());
  }
}

// ===============================
// 🌍 TRADUÇÃO COM FALLBACK
// ===============================
function translateWithFallback(title, description) {
  const gemini = translateWithGemini(title, description);

  if (gemini.success) {
    return gemini.data;
  }

  return {
    title: LanguageApp.translate(title, "en", "pt"),
    description: description
      ? LanguageApp.translate(description, "en", "pt")
      : ""
  };
}

// ===============================
// 🤖 GEMINI (1 CALL)
// ===============================
function translateWithGemini(title, description) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

  const payload = {
    contents: [{
      parts: [{
        text:
`Traduza para português do Brasil e responda SOMENTE em JSON válido.

{
  "title": "...",
  "description": "..."
}

TITLE: ${title}
DESCRIPTION: ${description}`
      }]
    }]
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { "X-goog-api-key": GEMINI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      return { success: false };
    }

    const json = JSON.parse(response.getContentText());
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) return { success: false };

    return {
      success: true,
      data: JSON.parse(text)
    };

  } catch {
    return { success: false };
  }
}

// ===============================
// 🧹 LIMPA HTML (PADRONIZA TÓPICOS)
// ===============================
function cleanHtml(html) {
  if (!html) return "";

  let text = html;

  // Remove imagens
  text = text.replace(/<img[^>]*>/gi, "");

  // Converte <li> em bullet (uma linha por item)
  text = text
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "");

  // Remove quebras quebradas
  text = text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "");

  // Remove qualquer outra tag HTML
  text = text.replace(/<\/?[^>]+>/gi, "");

  // Normaliza espaços e quebras
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\s+/g, "\n")
    .trim();

  return text;
}

// ===============================
// ✂️ LIMITA TAMANHO
// ===============================
function limitText(text, max) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.substring(0, max).trim() + "...";
}

// ===============================
// 📅 FORMATA DATA
// ===============================
function formatPostDate(item, ns, isAtom) {
  let dateText = "";

  if (isAtom) {
    dateText =
      item.getChild("published", ns)?.getText() ||
      item.getChild("updated", ns)?.getText();
  } else {
    dateText = item.getChild("pubDate", ns)?.getText();
  }

  if (!dateText) return "";

  const date = new Date(dateText);
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

// ===============================
// 🏷️ CATEGORIA + EMOJI
// ===============================
function detectCategory(title, description) {
  const text = (title + " " + description).toLowerCase();

  if (text.includes("google chat") || text.includes("chat")) {
    return { label: "Google Chat", emoji: "💬" };
  }
  if (text.includes("security") || text.includes("segurança")) {
    return { label: "Segurança", emoji: "🔐" };
  }
  if (text.includes("gmail")) {
    return { label: "Gmail", emoji: "📧" };
  }
  if (text.includes("drive") || text.includes("docs") || text.includes("sheets") || text.includes("slides")) {
    return { label: "Drive & Docs", emoji: "📂" };
  }
  if (text.includes("gemini") || text.includes("ai") || text.includes("inteligência artificial")) {
    return { label: "Inteligência Artificial", emoji: "🤖" };
  }

  return { label: "Google Workspace", emoji: "🧩" };
}

// ===============================
// 🧪 TESTE / CACHE
// ===============================
function testeFinal() {
  processNewsWithGemini();
}

function resetarCache() {
  PropertiesService.getScriptProperties().deleteProperty("LAST_LINK");
  Logger.log("✅ Cache limpo");
}
