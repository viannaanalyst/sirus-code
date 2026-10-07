/**
 * The app's icon set: Phosphor (MIT), adapted to the props call sites already use
 * (`size`, `strokeWidth`, `fill`, `className`). Lucide-era names map to the
 * closest Phosphor glyph so imports stay stable; `fill` other than "none" selects
 * the filled weight (pins, active items). See docs/development/ui-arc.md.
 */
import { forwardRef, type ComponentType, type SVGProps } from "react";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
import {
  AppWindow as PhAppWindow,
  DeviceMobile as PhDeviceMobile,
  RectangleDashed as PhRectangleDashed,
  Power as PhPower,
  Camera as PhCameraIcon,
  House as PhHouseIcon,
  DeviceRotate as PhDeviceRotate,
  Archive as PhArchive,
  ArrowBendDownRight as PhArrowBendDownRight,
  ArrowBendUpLeft as PhArrowBendUpLeft,
  ArrowClockwise as PhArrowClockwise,
  ArrowCounterClockwise as PhArrowCounterClockwise,
  ArrowDown as PhArrowDown,
  ArrowLeft as PhArrowLeft,
  ArrowLineUp as PhArrowLineUp,
  ArrowRight as PhArrowRight,
  ArrowSquareOut as PhArrowSquareOut,
  ArrowUUpLeft as PhArrowUUpLeft,
  ArrowUUpRight as PhArrowUUpRight,
  ArrowUp as PhArrowUp,
  ArrowsClockwise as PhArrowsClockwise,
  ArrowsDownUp as PhArrowsDownUp,
  ArrowsInLineVertical as PhArrowsInLineVertical,
  Bell as PhBell,
  Binoculars as PhBinoculars,
  BoxArrowUp as PhBoxArrowUp,
  BracketsCurly as PhBracketsCurly,
  Bug as PhBug,
  CalendarDots as PhCalendarDots,
  Camera as PhCamera,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUp as PhCaretUp,
  CaretUpDown as PhCaretUpDown,
  ChatCentered as PhChatCentered,
  ChatCenteredText as PhChatCenteredText,
  ChatCircle as PhChatCircle,
  Chats as PhChats,
  ChatsCircle as PhChatsCircle,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  CircleDashed as PhCircleDashed,
  CircleHalf as PhCircleHalf,
  CircleNotch as PhCircleNotch,
  Clock as PhClock,
  Gauge as PhGauge,
  Rows as PhRows,
  Code as PhCode,
  CodeBlock as PhCodeBlock,
  Command as PhCommand,
  Copy as PhCopy,
  CornersIn as PhCornersIn,
  CornersOut as PhCornersOut,
  Cube as PhCube,
  Cursor as PhCursor,
  CursorClick as PhCursorClick,
  DotsThree as PhDotsThree,
  DownloadSimple as PhDownloadSimple,
  Eraser as PhEraser,
  Eye as PhEye,
  EyeSlash as PhEyeSlash,
  Eyedropper as PhEyedropper,
  File as PhFile,
  FileAudio as PhFileAudio,
  FileCode as PhFileCode,
  FileCsv as PhFileCsv,
  FileImage as PhFileImage,
  FileLock as PhFileLock,
  FilePlus as PhFilePlus,
  FileText as PhFileText,
  FileVideo as PhFileVideo,
  FileZip as PhFileZip,
  Files as PhFiles,
  Flask as PhFlask,
  FloppyDisk as PhFloppyDisk,
  Folder as PhFolder,
  FolderOpen as PhFolderOpen,
  FolderPlus as PhFolderPlus,
  FolderSimple as PhFolderSimple,
  FolderSimpleStar as PhFolderSimpleStar,
  FunnelSimple as PhFunnelSimple,
  GearSix as PhGearSix,
  GitBranch as PhGitBranch,
  GitCommit as PhGitCommit,
  GitDiff as PhGitDiff,
  GitFork as PhGitFork,
  GitMerge as PhGitMerge,
  GitPullRequest as PhGitPullRequest,
  Globe as PhGlobe,
  Hammer as PhHammer,
  Hand as PhHand,
  Hash as PhHash,
  Image as PhImage,
  Info as PhInfo,
  Kanban as PhKanban,
  Keyboard as PhKeyboard,
  Laptop as PhLaptop,
  Lightbulb as PhLightbulb,
  Lightning as PhLightning,
  Link as PhLink,
  LinkBreak as PhLinkBreak,
  LinkSimple as PhLinkSimple,
  List as PhList,
  ListMagnifyingGlass as PhListMagnifyingGlass,
  ListNumbers as PhListNumbers,
  ListPlus as PhListPlus,
  Lock as PhLock,
  MagnifyingGlass as PhMagnifyingGlass,
  Microphone as PhMicrophone,
  Minus as PhMinus,
  MinusCircle as PhMinusCircle,
  Monitor as PhMonitor,
  Moon as PhMoon,
  NotePencil as PhNotePencil,
  Notebook as PhNotebook,
  Package as PhPackage,
  Paperclip as PhPaperclip,
  Paragraph as PhParagraph,
  Pause as PhPause,
  PencilLine as PhPencilLine,
  PencilSimple as PhPencilSimple,
  Play as PhPlay,
  Plus as PhPlus,
  PlugsConnected as PhPlugsConnected,
  Prohibit as PhProhibit,
  PushPin as PhPushPin,
  PushPinSlash as PhPushPinSlash,
  PuzzlePiece as PhPuzzlePiece,
  Question as PhQuestion,
  Quotes as PhQuotes,
  Record as PhRecord,
  Robot as PhRobot,
  SelectionForeground as PhSelectionForeground,
  ShareNetwork as PhShareNetwork,
  Shield as PhShield,
  ShieldCheck as PhShieldCheck,
  ShieldWarning as PhShieldWarning,
  Sidebar as PhSidebar,
  SidebarSimple as PhSidebarSimple,
  SignIn as PhSignIn,
  SignOut as PhSignOut,
  SlidersHorizontal as PhSlidersHorizontal,
  Smiley as PhSmiley,
  Sparkle as PhSparkle,
  Star as PhStar,
  Stop as PhStop,
  Sun as PhSun,
  Target as PhTarget,
  Terminal as PhTerminal,
  TerminalWindow as PhTerminalWindow,
  TextB as PhTextB,
  TextHOne as PhTextHOne,
  TextHThree as PhTextHThree,
  TextHTwo as PhTextHTwo,
  TextItalic as PhTextItalic,
  TextStrikethrough as PhTextStrikethrough,
  Trash as PhTrash,
  TreeStructure as PhTreeStructure,
  User as PhUser,
  Users as PhUsers,
  Warning as PhWarning,
  WarningCircle as PhWarningCircle,
  Wrench as PhWrench,
  X as PhX,
  Tray as PhTray,
  ListChecks as PhListChecks,
  ClipboardText as PhClipboardText,
  BookmarkSimple as PhBookmarkSimple,
  DotsSixVertical as PhDotsSixVertical,
  XCircle as PhXCircle,
} from "@phosphor-icons/react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref" | "fill"> {
  size?: number | string;
  /** Ignored: Phosphor weights replace stroke widths (kept for call-site compatibility). */
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  /** Any value other than "none" renders the filled glyph. */
  fill?: string;
  weight?: IconWeight;
  color?: string;
}
export type LucideIcon = ComponentType<IconProps>;

function adapt(Glyph: PhosphorIcon, name: string, mirrored = false): LucideIcon {
  const Adapted = forwardRef<SVGSVGElement, IconProps>(function Adapted({ size = 24, strokeWidth, absoluteStrokeWidth, fill, weight, ...rest }, ref) {
    void strokeWidth; void absoluteStrokeWidth; // Lucide-only props; Phosphor uses weights.
    return <Glyph ref={ref} size={size} weight={weight ?? (fill && fill !== "none" ? "fill" : "regular")} mirrored={mirrored} {...rest} />;
  });
  Adapted.displayName = name;
  return Adapted;
}

export const AlertCircle = adapt(PhWarningCircle, "AlertCircle");
export const AlertTriangle = adapt(PhWarning, "AlertTriangle");
export const AppWindow = adapt(PhAppWindow, "AppWindow");
export const Archive = adapt(PhArchive, "Archive");
export const ArchiveRestore = adapt(PhBoxArrowUp, "ArchiveRestore");
export const ArrowDown = adapt(PhArrowDown, "ArrowDown");
export const ArrowLeft = adapt(PhArrowLeft, "ArrowLeft");
export const ArrowRight = adapt(PhArrowRight, "ArrowRight");
export const ArrowUp = adapt(PhArrowUp, "ArrowUp");
export const ArrowUpDown = adapt(PhArrowsDownUp, "ArrowUpDown");
export const ArrowUpFromLine = adapt(PhArrowLineUp, "ArrowUpFromLine");
export const Bell = adapt(PhBell, "Bell");
export const Bold = adapt(PhTextB, "Bold");
export const Bot = adapt(PhRobot, "Bot");
export const Box = adapt(PhCube, "Box");
export const Bug = adapt(PhBug, "Bug");
export const CalendarDays = adapt(PhCalendarDots, "CalendarDays");
export const Camera = adapt(PhCamera, "Camera");
export const Check = adapt(PhCheck, "Check");
export const CheckCircle2 = adapt(PhCheckCircle, "CheckCircle2");
export const ChevronDown = adapt(PhCaretDown, "ChevronDown");
export const ChevronLeft = adapt(PhCaretLeft, "ChevronLeft");
export const ChevronRight = adapt(PhCaretRight, "ChevronRight");
export const ChevronUp = adapt(PhCaretUp, "ChevronUp");
export const ChevronsDownUp = adapt(PhArrowsInLineVertical, "ChevronsDownUp");
export const ChevronsUpDown = adapt(PhCaretUpDown, "ChevronsUpDown");
export const CircleAlert = adapt(PhWarningCircle, "CircleAlert");
export const CircleCheck = adapt(PhCheckCircle, "CircleCheck");
export const CircleDashed = adapt(PhCircleDashed, "CircleDashed");
export const CircleDot = adapt(PhRecord, "CircleDot");
export const CircleHelp = adapt(PhQuestion, "CircleHelp");
export const CircleMinus = adapt(PhMinusCircle, "CircleMinus");
export const CircleX = adapt(PhXCircle, "CircleX");
export const Clock3 = adapt(PhClock, "Clock3");
export const Code = adapt(PhCode, "Code");
export const Columns3 = adapt(PhKanban, "Columns3");
export const Command = adapt(PhCommand, "Command");
export const Copy = adapt(PhCopy, "Copy");
export const CornerDownRight = adapt(PhArrowBendDownRight, "CornerDownRight");
export const CornerUpLeft = adapt(PhArrowBendUpLeft, "CornerUpLeft");
export const Download = adapt(PhDownloadSimple, "Download");
export const Ellipsis = adapt(PhDotsThree, "Ellipsis");
export const Eraser = adapt(PhEraser, "Eraser");
export const ExternalLink = adapt(PhArrowSquareOut, "ExternalLink");
export const Eye = adapt(PhEye, "Eye");
export const EyeOff = adapt(PhEyeSlash, "EyeOff");
export const File = adapt(PhFile, "File");
export const FileArchive = adapt(PhFileZip, "FileArchive");
export const FileAudio = adapt(PhFileAudio, "FileAudio");
export const FileCode2 = adapt(PhFileCode, "FileCode2");
export const FileCog = adapt(PhFileText, "FileCog");
export const FileDiff = adapt(PhGitDiff, "FileDiff");
export const FileImage = adapt(PhFileImage, "FileImage");
export const FileJson = adapt(PhBracketsCurly, "FileJson");
export const FileLock = adapt(PhFileLock, "FileLock");
export const FilePenLine = adapt(PhPencilLine, "FilePenLine");
export const FilePlay = adapt(PhFileVideo, "FilePlay");
export const FilePlus = adapt(PhFilePlus, "FilePlus");
export const FileSpreadsheet = adapt(PhFileCsv, "FileSpreadsheet");
export const FileTerminal = adapt(PhTerminalWindow, "FileTerminal");
export const FileText = adapt(PhFileText, "FileText");
export const FileVideo = adapt(PhFileVideo, "FileVideo");
export const Files = adapt(PhFiles, "Files");
export const FlaskConical = adapt(PhFlask, "FlaskConical");
export const FoldVertical = adapt(PhArrowsInLineVertical, "FoldVertical");
export const Folder = adapt(PhFolder, "Folder");
export const FolderBookmark = adapt(PhFolderSimpleStar, "FolderBookmark");
export const FolderCheck = adapt(PhFolderSimple, "FolderCheck");
export const FolderCode = adapt(PhFolderSimple, "FolderCode");
export const FolderCog = adapt(PhFolderSimple, "FolderCog");
export const FolderGit2 = adapt(PhTreeStructure, "FolderGit2");
export const FolderOpen = adapt(PhFolderOpen, "FolderOpen");
export const FolderOutput = adapt(PhFolderSimple, "FolderOutput");
export const FolderPlus = adapt(PhFolderPlus, "FolderPlus");
export const FolderRoot = adapt(PhFolderSimple, "FolderRoot");
export const FolderSearch = adapt(PhFolderSimple, "FolderSearch");
export const GitBranch = adapt(PhGitBranch, "GitBranch");
export const GitBranchPlus = adapt(PhGitBranch, "GitBranchPlus");
export const GitCommitHorizontal = adapt(PhGitCommit, "GitCommitHorizontal");
export const GitCompareArrows = adapt(PhGitDiff, "GitCompareArrows");
export const GitFork = adapt(PhGitFork, "GitFork");
export const GitMerge = adapt(PhGitMerge, "GitMerge");
export const GitPullRequest = adapt(PhGitPullRequest, "GitPullRequest");
export const GitPullRequestClosed = adapt(PhGitPullRequest, "GitPullRequestClosed");
export const GitPullRequestDraft = adapt(PhGitPullRequest, "GitPullRequestDraft");
export const Globe = adapt(PhGlobe, "Globe");
export const Hammer = adapt(PhHammer, "Hammer");
export const Hand = adapt(PhHand, "Hand");
export const Hash = adapt(PhHash, "Hash");
export const Heading1 = adapt(PhTextHOne, "Heading1");
export const Heading2 = adapt(PhTextHTwo, "Heading2");
export const Heading3 = adapt(PhTextHThree, "Heading3");
export const ImagePlus = adapt(PhImage, "ImagePlus");
export const Info = adapt(PhInfo, "Info");
export const Italic = adapt(PhTextItalic, "Italic");
export const Keyboard = adapt(PhKeyboard, "Keyboard");
export const Laptop = adapt(PhLaptop, "Laptop");
export const Lightbulb = adapt(PhLightbulb, "Lightbulb");
export const Link = adapt(PhLink, "Link");
export const Link2 = adapt(PhLinkSimple, "Link2");
export const List = adapt(PhList, "List");
export const ListFilter = adapt(PhFunnelSimple, "ListFilter");
export const ListOrdered = adapt(PhListNumbers, "ListOrdered");
export const ListPlus = adapt(PhListPlus, "ListPlus");
export const LoaderCircle = adapt(PhCircleNotch, "LoaderCircle");
export const Lock = adapt(PhLock, "Lock");
export const LogIn = adapt(PhSignIn, "LogIn");
export const LogOut = adapt(PhSignOut, "LogOut");
export const Maximize2 = adapt(PhCornersOut, "Maximize2");
export const MessageCircle = adapt(PhChatCircle, "MessageCircle");
export const MessageSquare = adapt(PhChatCentered, "MessageSquare");
export const MessageSquarePlus = adapt(PhChatCenteredText, "MessageSquarePlus");
export const MessagesSquare = adapt(PhChats, "MessagesSquare");
export const MessagesCircle = adapt(PhChatsCircle, "MessagesCircle");
export const Gauge = adapt(PhGauge, "Gauge");
export const Rows = adapt(PhRows, "Rows");
export const Mic = adapt(PhMicrophone, "Mic");
export const Minimize2 = adapt(PhCornersIn, "Minimize2");
export const Minus = adapt(PhMinus, "Minus");
export const Monitor = adapt(PhMonitor, "Monitor");
export const Moon = adapt(PhMoon, "Moon");
export const MoreHorizontal = adapt(PhDotsThree, "MoreHorizontal");
export const MousePointer2 = adapt(PhCursor, "MousePointer2");
export const MousePointerClick = adapt(PhCursorClick, "MousePointerClick");
export const NotebookText = adapt(PhNotebook, "NotebookText");
export const OctagonX = adapt(PhProhibit, "OctagonX");
export const Package = adapt(PhPackage, "Package");
export const PanelLeft = adapt(PhSidebarSimple, "PanelLeft");
export const PanelRight = adapt(PhSidebarSimple, "PanelRight", true);
export const PanelRightClose = adapt(PhSidebarSimple, "PanelRightClose", true);
export const PanelRightOpen = adapt(PhSidebar, "PanelRightOpen", true);
export const Paperclip = adapt(PhPaperclip, "Paperclip");
export const Pause = adapt(PhPause, "Pause");
export const Pencil = adapt(PhPencilSimple, "Pencil");
export const Pilcrow = adapt(PhParagraph, "Pilcrow");
export const Pin = adapt(PhPushPin, "Pin");
export const PinOff = adapt(PhPushPinSlash, "PinOff");
export const Pipette = adapt(PhEyedropper, "Pipette");
export const Play = adapt(PhPlay, "Play");
export const Plus = adapt(PhPlus, "Plus");
export const Plug = adapt(PhPlugsConnected, "Plug");
export const Puzzle = adapt(PhPuzzlePiece, "Puzzle");
export const Quote = adapt(PhQuotes, "Quote");
export const Redo2 = adapt(PhArrowUUpRight, "Redo2");
export const RefreshCw = adapt(PhArrowsClockwise, "RefreshCw");
export const RotateCcw = adapt(PhArrowCounterClockwise, "RotateCcw");
export const RotateCw = adapt(PhArrowClockwise, "RotateCw");
export const Save = adapt(PhFloppyDisk, "Save");
export const Search = adapt(PhMagnifyingGlass, "Search");
export const Settings = adapt(PhGearSix, "Settings");
export const Settings2 = adapt(PhSlidersHorizontal, "Settings2");
export const Share2 = adapt(PhShareNetwork, "Share2");
export const Shield = adapt(PhShield, "Shield");
export const ShieldAlert = adapt(PhShieldWarning, "ShieldAlert");
export const ShieldCheck = adapt(PhShieldCheck, "ShieldCheck");
export const SlidersHorizontal = adapt(PhSlidersHorizontal, "SlidersHorizontal");
export const SmilePlus = adapt(PhSmiley, "SmilePlus");
export const Sparkles = adapt(PhSparkle, "Sparkles");
export const Square = adapt(PhStop, "Square");
export const SquareArrowOutUpRight = adapt(PhArrowSquareOut, "SquareArrowOutUpRight");
export const SquareCode = adapt(PhCodeBlock, "SquareCode");
export const SquareDashedMousePointer = adapt(PhSelectionForeground, "SquareDashedMousePointer");
export const SquarePen = adapt(PhNotePencil, "SquarePen");
export const SquareTerminal = adapt(PhTerminalWindow, "SquareTerminal");
export const Star = adapt(PhStar, "Star");
export const Strikethrough = adapt(PhTextStrikethrough, "Strikethrough");
export const Sun = adapt(PhSun, "Sun");
export const SunMoon = adapt(PhCircleHalf, "SunMoon");
export const Target = adapt(PhTarget, "Target");
export const Telescope = adapt(PhBinoculars, "Telescope");
export const Terminal = adapt(PhTerminal, "Terminal");
export const TerminalSquare = adapt(PhTerminalWindow, "TerminalSquare");
export const TextSearch = adapt(PhListMagnifyingGlass, "TextSearch");
export const Trash2 = adapt(PhTrash, "Trash2");
export const TriangleAlert = adapt(PhWarning, "TriangleAlert");
export const Undo2 = adapt(PhArrowUUpLeft, "Undo2");
export const UserRound = adapt(PhUser, "UserRound");
export const Users = adapt(PhUsers, "Users");
export const Wrench = adapt(PhWrench, "Wrench");
export const X = adapt(PhX, "X");
export const XCircle = adapt(PhXCircle, "XCircle");
export const Zap = adapt(PhLightning, "Zap");
export const Inbox = adapt(PhTray, "Inbox");
export const ListTodo = adapt(PhListChecks, "ListTodo");
export const ClipboardList = adapt(PhClipboardText, "ClipboardList");
export const Bookmark = adapt(PhBookmarkSimple, "Bookmark");
export const GripVertical = adapt(PhDotsSixVertical, "GripVertical");
export const Smartphone = adapt(PhDeviceMobile, "Smartphone");
export const RecordDot = adapt(PhRecord, "RecordDot");
export const PowerIcon = adapt(PhPower, "PowerIcon");
export const Unlink = adapt(PhLinkBreak, "Unlink");
export const CameraShot = adapt(PhCameraIcon, "CameraShot");
export const HomeButton = adapt(PhHouseIcon, "HomeButton");
export const RotateView = adapt(PhDeviceRotate, "RotateView");
export const ScreenDashed = adapt(PhRectangleDashed, "ScreenDashed");
