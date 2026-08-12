import emojiData from "./emojiData.json";

type CatId = keyof typeof emojiData;

const CATEGORY_KEYS: Record<CatId, string> = {
  smileys:
    "rosto face smiley feliz alegre triste rindo choro raiva bravo amor beijo sono pensando legal cool nerd diabo fantasma alien robô gato",
  people:
    "pessoa gente mão gesto joinha like dislike aplauso forca musculo bebe mulher homem policia ninja santa mago zumbi danca corrida",
  animals:
    "animal bicho pet gato cachorro cao caozinho urso panda raposa tigre leao porco sapo macaco passaro peixe tubarao dinossauro inseto planta flor arvore",
  food:
    "comida food bebida drink fruta pizza hamburger batata cafe cerveja vinho sushi doce bolo chocolate sorvete cha leite",
  activities:
    "esporte sport jogo game bola futebol basquete tenis trofeu medalha musica arte teatro filme microfone guitarra",
  travel:
    "viagem travel carro onibus aviao foguete barco trem metro casa predio praia montanha ponte",
  objects:
    "objeto object celular telefone computador camera dinheiro dinheiro presente livro chave porta cama luz bateria",
  symbols:
    "simbolo symbol coracao heart amor paz check alerta seta som musica estrela",
};

/** Termos específicos (pt/en) → emoji. Cobrem as buscas mais comuns. */
const EXTRA: Record<string, string> = {
  "😀": "sorriso feliz smile happy grin",
  "😁": "sorriso feliz smile",
  "😂": "rindo choro alegria lol haha laugh",
  "🤣": "rindo rofl lol",
  "😊": "contente blush feliz",
  "😍": "apaixonado amor love heart eyes",
  "🤩": "estrelas wow star",
  "😘": "beijo kiss amor",
  "😎": "estilo cool oculos sunglasses",
  "🤔": "pensando hmm think",
  "😴": "sono sleep cansado",
  "😭": "chorando sad choro cry",
  "😡": "bravo raiva angry mad",
  "🤯": "explodindo mind blown",
  "🥳": "festa party celebrar",
  "👍": "joinha ok like thumbs up sim",
  "👎": "nao dislike thumbs down",
  "👏": "aplausos clap",
  "🙌": "maos raise",
  "🙏": "obrigado please pray valeu",
  "💪": "forca muscle strong",
  "✌️": "paz peace",
  "👋": "tchau oi hello wave ola",
  "❤️": "coracao heart amor love vermelho",
  "❤": "coracao heart amor love vermelho",
  "🧡": "coracao laranja heart",
  "💛": "coracao amarelo heart",
  "💚": "coracao verde heart",
  "💙": "coracao azul heart",
  "💜": "coracao roxo heart",
  "🖤": "coracao preto heart",
  "🤍": "coracao branco heart",
  "💔": "coracao partido broken",
  "🔥": "fogo fire hot",
  "✨": "brilho sparkle",
  "⭐": "estrela star",
  "🌟": "estrela star",
  "💯": "cem 100 perfect",
  "🎉": "festa party confete tada",
  "🎈": "balao balloon",
  "🎁": "presente gift",
  "🚀": "foguete rocket",
  "🌈": "arcoiris rainbow",
  "🍕": "pizza",
  "🍔": "hamburger burger lanche",
  "🍟": "batata fries",
  "🍩": "donut doce",
  "☕": "cafe coffee",
  "🍺": "cerveja beer",
  "🍷": "vinho wine",
  "🎮": "game jogo controle",
  "🎧": "fone headphone musica",
  "🎵": "musica music",
  "🐶": "cachorro dog cao",
  "🐱": "gato cat",
  "🐭": "rato mouse",
  "🐹": "hamster",
  "🐰": "coelho rabbit",
  "🦊": "raposa fox",
  "🐻": "urso bear",
  "🐼": "panda",
  "🐸": "sapo frog",
  "🐵": "macaco monkey",
  "🦄": "unicornio unicorn",
  "🐝": "abelha bee",
  "🍎": "maca apple",
  "🍌": "banana",
  "🍇": "uva grape",
  "🍓": "morango strawberry",
  "🍉": "melancia watermelon",
  "🍋": "limao lemon",
  "🍊": "laranja orange",
  "🥑": "abacate avocado",
  "🌮": "taco",
  "🍣": "sushi",
  "🍦": "sorvete ice cream",
  "🎂": "bolo cake aniversario",
  "🍪": "biscoito cookie",
  "⚽": "futebol soccer football",
  "🏀": "basquete basketball",
  "🎸": "guitarra guitar",
  "🎤": "microfone mic",
  "🎬": "filme cinema movie",
  "🏆": "trofeu trophy",
  "🚗": "carro car",
  "🚕": "taxi",
  "✈️": "aviao plane airplane",
  "✈": "aviao plane airplane",
  "🏠": "casa home house",
  "📱": "celular phone mobile",
  "💻": "computador laptop pc",
  "⌨️": "teclado keyboard",
  "⌨": "teclado keyboard",
  "📷": "camera",
  "💡": "ideia luz lampada idea",
  "🔒": "cadeado lock",
  "🔑": "chave key",
  "✅": "check ok certo",
  "❌": "x errado no",
  "⚠️": "alerta warning",
  "⚠": "alerta warning",
  "❓": "duvida pergunta question",
  "❗": "exclamacao",
  "💬": "balao chat message conversa",
  "👀": "olhos eyes olhar",
  "💀": "caveira skull dead",
  "👻": "fantasma ghost",
  "🤖": "robo robot bot",
  "💩": "coco poop",
  "🌙": "lua moon",
  "☀️": "sol sun",
  "☀": "sol sun",
};

const index: { glyph: string; hay: string }[] = [];

for (const cat of Object.keys(emojiData) as CatId[]) {
  const catKeys = CATEGORY_KEYS[cat] ?? cat;
  for (const glyph of emojiData[cat] as string[]) {
    const extra = EXTRA[glyph] ?? "";
    index.push({
      glyph,
      hay: `${cat} ${catKeys} ${extra}`.toLowerCase(),
    });
  }
}

export function searchEmojis(query: string, category: CatId): string[] {
  const term = query.trim().toLowerCase();
  if (!term) {
    return emojiData[category] as string[];
  }

  // Colar emoji ou caractere isolado
  if ([...term].some((ch) => /\p{Extended_Pictographic}/u.test(ch))) {
    const found = index.filter((e) => e.glyph.includes(term)).map((e) => e.glyph);
    return [...new Set(found)];
  }

  const hits = index.filter((e) => e.hay.includes(term)).map((e) => e.glyph);
  return [...new Set(hits)];
}

export type { CatId };
