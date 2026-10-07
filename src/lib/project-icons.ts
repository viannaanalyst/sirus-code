import type { Icon } from "@phosphor-icons/react";
import { Folder as PhFolder, Code as PhCode, Terminal as PhTerminal, BookOpen as PhBookOpen, GraduationCap as PhGraduationCap, PencilSimple as PhPencilSimple, Feather as PhFeather, Briefcase as PhBriefcase, MusicNotes as PhMusicNotes, ChartBar as PhChartBar, Barbell as PhBarbell, Scales as PhScales, Globe as PhGlobe, AirplaneTilt as PhAirplaneTilt, Wrench as PhWrench, PawPrint as PhPawPrint, Flask as PhFlask, Brain as PhBrain, Heart as PhHeart, Tree as PhTree, Rocket as PhRocket, Lightbulb as PhLightbulb, Star as PhStar, Coffee as PhCoffee, Camera as PhCamera, ShoppingCart as PhShoppingCart, House as PhHouse, Car as PhCar, GameController as PhGameController, Palette as PhPalette, Database as PhDatabase, Cloud as PhCloud, Lock as PhLock, Key as PhKey, CurrencyDollar as PhCurrencyDollar, Bank as PhBank, Stethoscope as PhStethoscope, ChatCircle as PhChatCircle, Envelope as PhEnvelope, DeviceMobile as PhDeviceMobile, CalendarBlank as PhCalendarBlank, Robot as PhRobot, Cpu as PhCpu, Bug as PhBug, Leaf as PhLeaf, Sun as PhSun, Moon as PhMoon, Fire as PhFire, Lightning as PhLightning, Cube as PhCube, PuzzlePiece as PhPuzzlePiece, Trophy as PhTrophy, Users as PhUsers, Storefront as PhStorefront, FilmSlate as PhFilmSlate, Newspaper as PhNewspaper, Atom as PhAtom, Cat as PhCat } from "@phosphor-icons/react";

/**
 * Line icons a project can show instead of its folder (after Synara). The names
 * match `project_look::ICONS` in Rust; `words` feed the picker's search (pt and en).
 */
export const PROJECT_ICONS: Record<string, { Icon: Icon; words: string }> = {
  "folder": { Icon: PhFolder, words: "pasta folder" },
  "code": { Icon: PhCode, words: "código code dev" },
  "terminal": { Icon: PhTerminal, words: "terminal shell cli" },
  "book-open": { Icon: PhBookOpen, words: "livro book docs" },
  "graduation-cap": { Icon: PhGraduationCap, words: "escola curso school" },
  "pencil-simple": { Icon: PhPencilSimple, words: "lápis editar pencil" },
  "feather": { Icon: PhFeather, words: "pena escrita feather" },
  "briefcase": { Icon: PhBriefcase, words: "trabalho maleta work" },
  "music-notes": { Icon: PhMusicNotes, words: "música music" },
  "chart-bar": { Icon: PhChartBar, words: "gráfico dados chart" },
  "barbell": { Icon: PhBarbell, words: "academia treino gym" },
  "scales": { Icon: PhScales, words: "lei justiça law" },
  "globe": { Icon: PhGlobe, words: "web mundo globe" },
  "airplane-tilt": { Icon: PhAirplaneTilt, words: "viagem avião travel" },
  "wrench": { Icon: PhWrench, words: "ferramenta tool" },
  "paw-print": { Icon: PhPawPrint, words: "pet animal" },
  "flask": { Icon: PhFlask, words: "ciência teste lab" },
  "brain": { Icon: PhBrain, words: "ia cérebro ai brain" },
  "heart": { Icon: PhHeart, words: "saúde amor heart" },
  "tree": { Icon: PhTree, words: "natureza árvore tree" },
  "rocket": { Icon: PhRocket, words: "foguete lançamento rocket" },
  "lightbulb": { Icon: PhLightbulb, words: "ideia idea" },
  "star": { Icon: PhStar, words: "estrela favorito star" },
  "coffee": { Icon: PhCoffee, words: "café coffee" },
  "camera": { Icon: PhCamera, words: "foto câmera photo" },
  "shopping-cart": { Icon: PhShoppingCart, words: "loja compras shop" },
  "house": { Icon: PhHouse, words: "casa home" },
  "car": { Icon: PhCar, words: "carro car" },
  "game-controller": { Icon: PhGameController, words: "jogo game" },
  "palette": { Icon: PhPalette, words: "design arte paleta" },
  "database": { Icon: PhDatabase, words: "banco dados database" },
  "cloud": { Icon: PhCloud, words: "nuvem cloud" },
  "lock": { Icon: PhLock, words: "segurança cadeado lock" },
  "key": { Icon: PhKey, words: "chave key" },
  "currency-dollar": { Icon: PhCurrencyDollar, words: "dinheiro finanças money" },
  "bank": { Icon: PhBank, words: "banco bank" },
  "stethoscope": { Icon: PhStethoscope, words: "saúde médico clínica" },
  "chat-circle": { Icon: PhChatCircle, words: "chat mensagem" },
  "envelope": { Icon: PhEnvelope, words: "email correio" },
  "device-mobile": { Icon: PhDeviceMobile, words: "celular app mobile" },
  "calendar-blank": { Icon: PhCalendarBlank, words: "agenda calendário" },
  "robot": { Icon: PhRobot, words: "robô bot ia" },
  "cpu": { Icon: PhCpu, words: "hardware cpu" },
  "bug": { Icon: PhBug, words: "bug erro" },
  "leaf": { Icon: PhLeaf, words: "folha eco" },
  "sun": { Icon: PhSun, words: "sol sun" },
  "moon": { Icon: PhMoon, words: "lua moon" },
  "fire": { Icon: PhFire, words: "fogo fire" },
  "lightning": { Icon: PhLightning, words: "raio rápido" },
  "cube": { Icon: PhCube, words: "cubo 3d pacote" },
  "puzzle-piece": { Icon: PhPuzzlePiece, words: "plugin peça" },
  "trophy": { Icon: PhTrophy, words: "troféu prêmio" },
  "users": { Icon: PhUsers, words: "pessoas equipe team" },
  "storefront": { Icon: PhStorefront, words: "loja vitrine store" },
  "film-slate": { Icon: PhFilmSlate, words: "vídeo filme" },
  "newspaper": { Icon: PhNewspaper, words: "notícias blog" },
  "atom": { Icon: PhAtom, words: "átomo react ciência" },
  "cat": { Icon: PhCat, words: "gato cat" },
};
export const PROJECT_ICON_NAMES = Object.keys(PROJECT_ICONS);

export function searchProjectIcons(query: string): string[] {
  const needle = query.trim().toLowerCase();
  return needle ? PROJECT_ICON_NAMES.filter((name) => `${name} ${PROJECT_ICONS[name].words}`.toLowerCase().includes(needle)) : PROJECT_ICON_NAMES;
}
