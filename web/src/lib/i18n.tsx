import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'pl'

const STORAGE_KEY = 'docdoctor.lang'

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'pl') return saved
  } catch {
    /* storage unavailable (private mode): fall through to the browser language */
  }
  return navigator.language?.toLowerCase().startsWith('pl') ? 'pl' : 'en'
}

// The current language lives at module level so plain helpers (labels, formatting, the
// API client) can read it without being React components. Switching language remounts
// the app (see LangProvider), so everything re-reads it.
let current: Lang = detect()
document.documentElement.lang = current

export const lang = () => current
export const locale = () => (current === 'pl' ? 'pl-PL' : undefined)

type Vars = Record<string, string | number>

function fill(text: string, vars?: Vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : text
}

/** Translates a key. Unknown keys fall back to English, then to the key itself. */
export function t(key: string, vars?: Vars): string {
  return fill(dict[current][key] ?? dict.en[key] ?? key, vars)
}

/** Translates a counted phrase, picking the plural form the language needs ("{n}" is filled in). */
export function tn(key: string, n: number, vars?: Vars): string {
  const form = new Intl.PluralRules(current).select(n)
  const table = dict[current]
  const text = table[`${key}.${form}`] ?? table[`${key}.other`] ?? dict.en[`${key}.${form}`] ?? dict.en[`${key}.other`] ?? key
  return fill(text, { n, ...vars })
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: current, setLang: () => undefined })

export function LangProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Lang>(current)
  const setLang = useCallback((l: Lang) => {
    current = l
    document.documentElement.lang = l
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* not persisted; still applies for this visit */
    }
    setValue(l)
  }, [])
  // The key remounts the tree so every screen picks up the new language at once.
  return (
    <LangContext.Provider value={{ lang: value, setLang }}>
      <div key={value} className="contents">
        {children}
      </div>
    </LangContext.Provider>
  )
}

/** A small "Polski / English" switch. */
export function LangSwitch({ className }: { className?: string }) {
  const { lang: active, setLang } = useContext(LangContext)
  const other: Lang = active === 'pl' ? 'en' : 'pl'
  return (
    <button
      onClick={() => setLang(other)}
      lang={other}
      className={className ?? 'text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'}
    >
      {other === 'pl' ? 'Polski' : 'English'}
    </button>
  )
}

const en: Record<string, string> = {
  'api.unreachable': 'Cannot reach Doc Doctor. Check your connection and try again.',
  'api.failed': 'Something went wrong ({status}).',

  // navigation and shell
  'nav.main': 'Main',
  'nav.documents': 'Documents',
  'nav.scan': 'Scan',
  'nav.ask': 'Ask',
  'nav.business': 'Business info',
  'nav.businessShort': 'Info',
  'nav.signOut': 'Sign out',
  'shell.readerPaused': 'Reading new documents is paused.',
  'shell.claudeOff': 'Questions and summaries are not switched on yet. Search works.',
  'setup.details': 'Setup details',
  'setup.claude':
    'The server has no Claude API key. Add ANTHROPIC_API_KEY to the .env file in the project folder and restart the server.',
  'setup.reader': 'The local OCR worker is not answering on port 8001. Start it with "make ocr".',

  // document status
  'status.waiting': 'Waiting',
  'status.reading': 'Reading',
  'status.filing': 'Filing',
  'status.failed': 'Could not read',
  'status.ready': 'Ready',

  // sign in
  'auth.heroTitle': 'Ask your filing cabinet a question.',
  'auth.heroQ': 'When does the office lease end?',
  'auth.heroA': 'On 28 February 2030, with six months’ notice.',
  'auth.heroFrom': 'From Umowa najmu lokalu, page 2',
  'auth.heroFoot': 'Scans are read on your own server first. Nothing is sent to an AI model unless you turn that on.',
  'auth.signIn': 'Sign in',
  'auth.signInSub': 'Open your document archive.',
  'auth.create': 'Create your archive',
  'auth.createSub': 'One workspace for your business documents.',
  'auth.linkExpired':
    'That phone code has expired or was already used. On your computer, open Scan with phone again for a new code, or sign in here.',
  'auth.org': 'Business name',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.passwordHint': 'At least 8 characters.',
  'auth.createBtn': 'Create archive',
  'auth.haveArchive': 'Already have an archive?',
  'auth.newHere': 'New here?',
  'auth.createLink': 'Create an archive',
  'auth.failed': 'Something went wrong.',

  // document types and business areas
  'type.invoice': 'Invoice',
  'type.receipt': 'Receipt',
  'type.contract': 'Contract',
  'type.letter': 'Letter',
  'type.form': 'Form',
  'type.report': 'Report',
  'type.other': 'Other',
  'type.unknown': 'Unsorted',
  'types.invoice': 'Invoices',
  'types.receipt': 'Receipts',
  'types.contract': 'Contracts',
  'types.letter': 'Letters',
  'types.form': 'Forms',
  'types.report': 'Reports',
  'types.other': 'Others',
  'cat.purchases': 'Purchases',
  'cat.sales': 'Sales',
  'cat.premises': 'Premises',
  'cat.banking': 'Banking',
  'cat.taxes': 'Taxes',
  'cat.payroll_hr': 'Payroll and HR',
  'cat.insurance': 'Insurance',
  'cat.legal': 'Legal',
  'cat.vehicles': 'Vehicles',
  'cat.it_telecom': 'IT and telecom',
  'cat.administration': 'Administration',
  'cat.other': 'Other',

  // documents list
  'docs.title': 'Documents',
  'docs.search': 'Search your documents',
  'docs.searchAria': 'Search documents',
  'docs.scanPhone': 'Scan with phone',
  'docs.upload': 'Upload files',
  'docs.uploading': 'Uploading {n}',
  'docs.uploadAria': 'Upload documents',
  'docs.filterAria': 'Filter documents',
  'docs.all': 'All',
  'docs.anyArea': 'Any area',
  'docs.areaAria': 'Filter by business area',
  'docs.foundInside': 'Found inside documents',
  'docs.foundAria': 'Matches inside documents',
  'docs.page': 'page {n}',
  'docs.nothing': 'Nothing matches that search.',
  'docs.nothingHint': 'Try a shorter word, or clear the filters.',
  'docs.firstTitle': 'Add your first document',
  'docs.step1': '1. Scan or upload.',
  'docs.step1d': 'Photograph a paper with your phone, or add files from this device.',
  'docs.step2': '2. We read and file it.',
  'docs.step2d': 'Each document is sorted by type and what it relates to.',
  'docs.step3': '3. Ask a question.',
  'docs.step3d': 'Answers show the page they came from.',
  'docs.dragHint': 'You can also drag files onto this page. PDFs and photos work, up to 50 MB each.',
  'docs.scanDoc': 'Scan a document',
  'docs.matching': 'Matching documents',
  'docs.listAria': 'Document list',
  'docs.colDocument': 'Document',
  'docs.colType': 'Type',
  'docs.colRelates': 'Relates to',
  'docs.colDated': 'Dated',
  'docs.colAmount': 'Amount',
  'docs.colStatus': 'Status',
  'docs.drop': 'Drop to add to the archive',
  'docs.loadErr': 'Could not load documents.',
  'docs.uploadErr': 'Upload failed.',
  'docs.added.one': '{n} file added. Reading it now.',
  'docs.added.other': '{n} files added. Reading them now.',
  'docs.dupes.one': '{n} file was already in the archive.',
  'docs.dupes.other': '{n} files were already in the archive.',
  'pages.one': '{n} page',
  'pages.other': '{n} pages',

  // scan with phone panel
  'phone.title': 'Scan with your phone',
  'phone.desc': 'Take photos of your papers and they appear in this list.',
  'phone.noNetwork': 'This computer is not on a network right now. Connect it to Wi-Fi, reload this page, and try again.',
  'phone.creating': 'Creating a code',
  'phone.s1': 'Make sure your phone is on the same Wi-Fi as this computer.',
  'phone.s2': 'Open the phone’s camera and point it at this code.',
  'phone.s3': 'Tap the link that appears. Doc Doctor opens, already signed in.',
  'phone.s4': 'Tap Take photo and photograph each page.',
  'phone.valid':
    'The code works once, for {n} minutes. Close and reopen this panel for a new one. It only works on your own Wi-Fi.',
  'phone.trouble': 'The code does not open anything',
  'phone.troubleA': 'On the phone, open the web browser and go to',
  'phone.troubleB':
    'then sign in with your email and password. If the page does not load, the computer’s firewall may be blocking it.',
  'phone.err': 'Could not create a phone code.',

  // one document
  'doc.back': 'Back to documents',
  'doc.missing': 'This document does not exist or was deleted.',
  'doc.readAgain': 'Read again',
  'doc.readingAgain': 'Reading it again.',
  'doc.readingCareful': 'Reading it again, more carefully.',
  'doc.readErr': 'Could not start a new read.',
  'doc.download': 'Download',
  'doc.delete': 'Delete',
  'doc.deleteAsk': 'Delete for good?',
  'doc.keep': 'Keep',
  'doc.deleted': 'Document deleted.',
  'doc.deleteErr': 'Could not delete the document.',
  'doc.failTitle': 'We could not read this file',
  'doc.failBody':
    'This sometimes happens with damaged files or very dark photos. Try again, and if it still fails, scan the document once more.',
  'doc.tryAgain': 'Try again',
  'doc.tech': 'Technical details',
  'doc.tags': 'Tags',
  'doc.factType': 'Type',
  'doc.factRelates': 'Relates to',
  'doc.factAbout': 'About',
  'doc.factDated': 'Dated',
  'doc.factCounterparty': 'Counterparty',
  'doc.factAmount': 'Amount',
  'doc.pagesTitle': 'Each page: the picture and what we read from it',
  'doc.page': 'Page {n}',
  'doc.hardPage': 'Hard to read, check it against the picture',
  'doc.noText': 'No text on this page.',
  'doc.openPicture': 'Open the picture at full size',
  'doc.pictureAlt': 'Picture of page {n}',
  'quality.clear': 'Read clearly',
  'quality.mostly': 'Mostly clear',
  'quality.hard': 'Hard to read',
  'note.no_text': 'We could not find any text in this file. If it is a photo, try again in better light.',
  'note.no_summary': 'This document can be searched. Summaries and key details are not switched on yet.',
  'note.summary_failed':
    'This document can be searched, but its summary and key details could not be created. Use Read again to retry.',
  'note.guessed': 'Its type was worked out from keywords, so check that it looks right.',
  'note.hard_to_read':
    'Parts of this scan were hard to read. Check the text against the picture, or scan it again in better light.',
  'note.read_twice': 'The first read was unclear, so this scan was read a second time more carefully.',

  // scan
  'scan.title': 'Scan a document',
  'scan.intro': 'Photograph each page in order. The pages are saved as one document, read, and filed automatically.',
  'scan.takeFirst': 'Take photo of page 1',
  'scan.choose': 'Choose from photos',
  'scan.tip1': 'Lay the page flat and fill the frame with it.',
  'scan.tip2': 'Avoid shadows and glare; daylight works best.',
  'scan.tip3': 'One page per photo.',
  'scan.takeAria': 'Take a photo of a page',
  'scan.chooseAria': 'Choose page photos',
  'scan.startOver': 'Start over',
  'scan.pageAlt': 'Page {n}',
  'scan.pageN': 'Page {n}',
  'scan.remove': 'Remove page {n}',
  'scan.addFromPhotos': 'Add from photos',
  'scan.theseAre': 'These photos are',
  'scan.one': 'One document',
  'scan.separate': 'Separate documents',
  'documents.one': '{n} document',
  'documents.other': '{n} documents',
  'scan.name': 'Name (optional)',
  'scan.namePh': 'Left blank, it is named by date',
  'scan.save': 'Save to archive',
  'scan.saving': 'Saving',
  'scan.onlyPhotos': 'Only photos can be added here. Upload PDFs from Documents.',
  'scan.max': 'A scan can have at most {n} pages.',
  'scan.already': 'This scan was already in the archive.',
  'scan.saved.one': 'Scan saved. Reading it now.',
  'scan.saved.other': '{n} scans saved. Reading them now.',
  'scan.saveErr': 'Could not save the scan. Check your connection and try again.',

  // ask
  'ask.title': 'Ask your archive',
  'ask.intro': 'Answers come from your scanned documents, and each one points to the page it was found on.',
  'ask.off': 'Questions are not switched on yet. You can still find documents with the search box on the Documents page.',
  'ask.starter1': 'Which invoices are due this month, and for how much?',
  'ask.starter2': 'How much did we spend with each supplier this year?',
  'ask.starter3': 'When does our office lease end, and what is the notice period?',
  'ask.new': 'New question',
  'ask.past': 'Past conversations',
  'ask.deleteConv': 'Delete conversation: {title}',
  'ask.placeholder': 'Type a question about your documents',
  'ask.inputAria': 'Your question',
  'ask.send': 'Send question',
  'ask.looking': 'Looking through the archive',
  'ask.writing': 'Writing',
  'ask.err': 'Could not get an answer.',
  'ask.noAnswer': 'No answer could be given this time. Try asking again.',
  'ask.noDoc': 'No document backs this answer.',
  'ask.noDocBody': 'It does not point to any page in your archive, so do not rely on it for facts.',
  'ask.numbers.one': 'One number is not written in the pages it read:',
  'ask.numbers.other': '{n} numbers are not written in the pages it read:',
  'ask.numbersTail.one': 'It may be worked out from other numbers, or may be wrong. Check it in the document.',
  'ask.numbersTail.other': 'They may be worked out from other numbers, or may be wrong. Check them in the document.',
  'ask.where': 'Where this comes from',
  'ask.sourcePage': '{title}, page {n}',
  'ask.sourceAria': 'Source {n}: {title}, page {page}',
  'ask.pageUnconfirmed': '(page could not be confirmed)',
  'ask.wordsMissing': '(these exact words are not on that page)',
  'ask.wordsMissingList': 'The exact words quoted were not found on this page. Check it yourself.',
  'peek.title': 'Source',
  'peek.page': 'Page {n}',
  'peek.pageQuote': 'Page {n}. The words the answer relies on are highlighted.',
  'peek.noPage': 'This document has no page {n}.',
  'peek.gone': 'This document is no longer in the archive.',
  'peek.loading': 'Loading page',
  'peek.open': 'Open the whole document',

  // business info
  'biz.title': 'Business info',
  'biz.intro':
    'Facts about {name} that the assistant should know when it answers. It reads this text and your uploaded documents, and nothing else.',
  'biz.introGeneric':
    'Facts about your business that the assistant should know when it answers. It reads this text and your uploaded documents, and nothing else.',
  'biz.label': 'What the assistant should know',
  'biz.example':
    'For example:\n\nWe are an accounting office in Gdynia with 6 staff.\nOur legal name is Biuro Rachunkowe Łoś i Wspólnicy sp.j., NIP 586-102-33-47.\nOur fiscal year is the calendar year. We report amounts in PLN.\n"Żuraw" means our stationery supplier, Hurtownia Papiernicza Żuraw Sp. z o.o.',
  'biz.help': 'Useful: legal name and tax ID, what you do, fiscal year, currency, nicknames for suppliers or clients.',
  'biz.save': 'Save business info',
  'biz.saved': 'Business info saved.',
  'biz.saveErr': 'Could not save business info.',
  'biz.loadErr': 'Could not load business info.',
  'biz.howTitle': 'How answers are kept to your documents',
  'biz.how1': 'The assistant can only look in this archive. It cannot browse the internet or see another business.',
  'biz.how2':
    'It is instructed to answer from your documents and this page only, and to say so when they do not hold the answer.',
  'biz.how3':
    'Each fact has a numbered yellow marker. Tap it to see the page and the exact words it came from. Words that are not really on that page are flagged.',
  'biz.how4':
    'Numbers that are not written in the pages it read are listed under the answer, so worked-out or wrong numbers stand out.',
}

const pl: Record<string, string> = {
  'api.unreachable': 'Nie można połączyć się z Doc Doctor. Sprawdź połączenie i spróbuj ponownie.',
  'api.failed': 'Coś poszło nie tak ({status}).',

  'nav.main': 'Menu główne',
  'nav.documents': 'Dokumenty',
  'nav.scan': 'Skanuj',
  'nav.ask': 'Zapytaj',
  'nav.business': 'O firmie',
  'nav.businessShort': 'Firma',
  'nav.signOut': 'Wyloguj się',
  'shell.readerPaused': 'Odczytywanie nowych dokumentów jest wstrzymane.',
  'shell.claudeOff': 'Pytania i streszczenia nie są jeszcze włączone. Wyszukiwanie działa.',
  'setup.details': 'Szczegóły konfiguracji',
  'setup.claude':
    'Serwer nie ma klucza Claude API. Dodaj ANTHROPIC_API_KEY do pliku .env w folderze projektu i uruchom serwer ponownie.',
  'setup.reader': 'Lokalna usługa OCR nie odpowiada na porcie 8001. Uruchom ją poleceniem „make ocr”.',

  'status.waiting': 'Czeka',
  'status.reading': 'Odczytywanie',
  'status.filing': 'Porządkowanie',
  'status.failed': 'Nie udało się odczytać',
  'status.ready': 'Gotowy',

  'auth.heroTitle': 'Zadaj pytanie swojej szafie z dokumentami.',
  'auth.heroQ': 'Kiedy kończy się umowa najmu biura?',
  'auth.heroA': '28 lutego 2030 r., z sześciomiesięcznym wypowiedzeniem.',
  'auth.heroFrom': 'Źródło: Umowa najmu lokalu, strona 2',
  'auth.heroFoot':
    'Skany są najpierw odczytywane na Twoim serwerze. Nic nie trafia do modelu AI, dopóki tego nie włączysz.',
  'auth.signIn': 'Zaloguj się',
  'auth.signInSub': 'Otwórz swoje archiwum dokumentów.',
  'auth.create': 'Załóż archiwum',
  'auth.createSub': 'Jedno miejsce na dokumenty Twojej firmy.',
  'auth.linkExpired':
    'Ten kod z telefonu wygasł albo został już użyty. Na komputerze otwórz ponownie „Skanuj telefonem”, aby dostać nowy kod, albo zaloguj się tutaj.',
  'auth.org': 'Nazwa firmy',
  'auth.email': 'E-mail',
  'auth.password': 'Hasło',
  'auth.passwordHint': 'Co najmniej 8 znaków.',
  'auth.createBtn': 'Załóż archiwum',
  'auth.haveArchive': 'Masz już archiwum?',
  'auth.newHere': 'Jesteś tu pierwszy raz?',
  'auth.createLink': 'Załóż archiwum',
  'auth.failed': 'Coś poszło nie tak.',

  'type.invoice': 'Faktura',
  'type.receipt': 'Paragon',
  'type.contract': 'Umowa',
  'type.letter': 'Pismo',
  'type.form': 'Formularz',
  'type.report': 'Raport',
  'type.other': 'Inny',
  'type.unknown': 'Nieposortowany',
  'types.invoice': 'Faktury',
  'types.receipt': 'Paragony',
  'types.contract': 'Umowy',
  'types.letter': 'Pisma',
  'types.form': 'Formularze',
  'types.report': 'Raporty',
  'types.other': 'Inne',
  'cat.purchases': 'Zakupy',
  'cat.sales': 'Sprzedaż',
  'cat.premises': 'Lokal',
  'cat.banking': 'Bank',
  'cat.taxes': 'Podatki',
  'cat.payroll_hr': 'Kadry i płace',
  'cat.insurance': 'Ubezpieczenia',
  'cat.legal': 'Sprawy prawne',
  'cat.vehicles': 'Pojazdy',
  'cat.it_telecom': 'IT i telefony',
  'cat.administration': 'Administracja',
  'cat.other': 'Inne',

  'docs.title': 'Dokumenty',
  'docs.search': 'Szukaj w dokumentach',
  'docs.searchAria': 'Szukaj w dokumentach',
  'docs.scanPhone': 'Skanuj telefonem',
  'docs.upload': 'Dodaj pliki',
  'docs.uploading': 'Przesyłanie: {n}',
  'docs.uploadAria': 'Dodaj dokumenty',
  'docs.filterAria': 'Filtruj dokumenty',
  'docs.all': 'Wszystkie',
  'docs.anyArea': 'Dowolny obszar',
  'docs.areaAria': 'Filtruj według obszaru firmy',
  'docs.foundInside': 'Znalezione w treści dokumentów',
  'docs.foundAria': 'Trafienia w treści dokumentów',
  'docs.page': 'strona {n}',
  'docs.nothing': 'Nic nie pasuje do tego wyszukiwania.',
  'docs.nothingHint': 'Spróbuj krótszego słowa albo wyczyść filtry.',
  'docs.firstTitle': 'Dodaj pierwszy dokument',
  'docs.step1': '1. Zeskanuj albo dodaj plik.',
  'docs.step1d': 'Zrób zdjęcie dokumentu telefonem albo dodaj pliki z tego urządzenia.',
  'docs.step2': '2. My go odczytamy i uporządkujemy.',
  'docs.step2d': 'Każdy dokument trafia do właściwego rodzaju i obszaru firmy.',
  'docs.step3': '3. Zadaj pytanie.',
  'docs.step3d': 'Odpowiedzi pokazują stronę, z której pochodzą.',
  'docs.dragHint': 'Możesz też przeciągnąć pliki na tę stronę. Działają pliki PDF i zdjęcia, do 50 MB każdy.',
  'docs.scanDoc': 'Zeskanuj dokument',
  'docs.matching': 'Pasujące dokumenty',
  'docs.listAria': 'Lista dokumentów',
  'docs.colDocument': 'Dokument',
  'docs.colType': 'Rodzaj',
  'docs.colRelates': 'Dotyczy',
  'docs.colDated': 'Data',
  'docs.colAmount': 'Kwota',
  'docs.colStatus': 'Stan',
  'docs.drop': 'Upuść, aby dodać do archiwum',
  'docs.loadErr': 'Nie udało się wczytać dokumentów.',
  'docs.uploadErr': 'Nie udało się dodać plików.',
  'docs.added.one': 'Dodano {n} plik. Trwa odczytywanie.',
  'docs.added.few': 'Dodano {n} pliki. Trwa odczytywanie.',
  'docs.added.many': 'Dodano {n} plików. Trwa odczytywanie.',
  'docs.added.other': 'Dodano {n} pliku. Trwa odczytywanie.',
  'docs.dupes.one': '{n} plik był już w archiwum.',
  'docs.dupes.few': '{n} pliki były już w archiwum.',
  'docs.dupes.many': '{n} plików było już w archiwum.',
  'docs.dupes.other': '{n} pliku było już w archiwum.',
  'pages.one': '{n} strona',
  'pages.few': '{n} strony',
  'pages.many': '{n} stron',
  'pages.other': '{n} strony',

  'phone.title': 'Skanuj telefonem',
  'phone.desc': 'Zrób zdjęcia dokumentów, a pojawią się na tej liście.',
  'phone.noNetwork':
    'Ten komputer nie jest teraz podłączony do sieci. Połącz go z Wi-Fi, odśwież stronę i spróbuj ponownie.',
  'phone.creating': 'Tworzenie kodu',
  'phone.s1': 'Upewnij się, że telefon jest w tej samej sieci Wi-Fi co ten komputer.',
  'phone.s2': 'Otwórz aparat w telefonie i skieruj go na ten kod.',
  'phone.s3': 'Dotknij linku, który się pojawi. Doc Doctor otworzy się od razu po zalogowaniu.',
  'phone.s4': 'Dotknij „Zrób zdjęcie” i sfotografuj każdą stronę.',
  'phone.valid':
    'Kod działa jeden raz, przez {n} minut. Zamknij i otwórz ten panel ponownie, aby dostać nowy. Działa tylko w Twojej sieci Wi-Fi.',
  'phone.trouble': 'Kod niczego nie otwiera',
  'phone.troubleA': 'W telefonie otwórz przeglądarkę i wejdź na adres',
  'phone.troubleB':
    'a potem zaloguj się e-mailem i hasłem. Jeśli strona się nie ładuje, może ją blokować zapora na komputerze.',
  'phone.err': 'Nie udało się utworzyć kodu dla telefonu.',

  'doc.back': 'Wróć do dokumentów',
  'doc.missing': 'Ten dokument nie istnieje albo został usunięty.',
  'doc.readAgain': 'Odczytaj ponownie',
  'doc.readingAgain': 'Odczytuję ponownie.',
  'doc.readingCareful': 'Odczytuję ponownie, dokładniej.',
  'doc.readErr': 'Nie udało się rozpocząć ponownego odczytu.',
  'doc.download': 'Pobierz',
  'doc.delete': 'Usuń',
  'doc.deleteAsk': 'Usunąć na stałe?',
  'doc.keep': 'Zostaw',
  'doc.deleted': 'Dokument usunięty.',
  'doc.deleteErr': 'Nie udało się usunąć dokumentu.',
  'doc.failTitle': 'Nie udało się odczytać tego pliku',
  'doc.failBody':
    'Zdarza się to przy uszkodzonych plikach albo bardzo ciemnych zdjęciach. Spróbuj ponownie, a jeśli to nie pomoże, zeskanuj dokument jeszcze raz.',
  'doc.tryAgain': 'Spróbuj ponownie',
  'doc.tech': 'Szczegóły techniczne',
  'doc.tags': 'Etykiety',
  'doc.factType': 'Rodzaj',
  'doc.factRelates': 'Dotyczy',
  'doc.factAbout': 'Temat',
  'doc.factDated': 'Data',
  'doc.factCounterparty': 'Kontrahent',
  'doc.factAmount': 'Kwota',
  'doc.pagesTitle': 'Każda strona: zdjęcie i to, co z niej odczytaliśmy',
  'doc.page': 'Strona {n}',
  'doc.hardPage': 'Słabo czytelna, porównaj ze zdjęciem',
  'doc.noText': 'Na tej stronie nie ma tekstu.',
  'doc.openPicture': 'Otwórz zdjęcie w pełnym rozmiarze',
  'doc.pictureAlt': 'Zdjęcie strony {n}',
  'quality.clear': 'Odczytano wyraźnie',
  'quality.mostly': 'W większości czytelne',
  'quality.hard': 'Słabo czytelne',
  'note.no_text': 'Nie znaleźliśmy w tym pliku żadnego tekstu. Jeśli to zdjęcie, spróbuj ponownie przy lepszym świetle.',
  'note.no_summary': 'Ten dokument można przeszukiwać. Streszczenia i najważniejsze dane nie są jeszcze włączone.',
  'note.summary_failed':
    'Ten dokument można przeszukiwać, ale nie udało się przygotować streszczenia i najważniejszych danych. Użyj „Odczytaj ponownie”.',
  'note.guessed': 'Rodzaj dokumentu ustalono na podstawie słów kluczowych, więc sprawdź, czy się zgadza.',
  'note.hard_to_read':
    'Części tego skanu były słabo czytelne. Porównaj tekst ze zdjęciem albo zeskanuj dokument ponownie przy lepszym świetle.',
  'note.read_twice': 'Pierwszy odczyt był niewyraźny, więc skan został odczytany drugi raz, dokładniej.',

  'scan.title': 'Zeskanuj dokument',
  'scan.intro':
    'Sfotografuj strony po kolei. Zostaną zapisane jako jeden dokument, odczytane i uporządkowane automatycznie.',
  'scan.takeFirst': 'Zrób zdjęcie strony 1',
  'scan.choose': 'Wybierz ze zdjęć',
  'scan.tip1': 'Połóż kartkę płasko i wypełnij nią cały kadr.',
  'scan.tip2': 'Unikaj cieni i odblasków; najlepsze jest światło dzienne.',
  'scan.tip3': 'Jedna strona na jedno zdjęcie.',
  'scan.takeAria': 'Zrób zdjęcie strony',
  'scan.chooseAria': 'Wybierz zdjęcia stron',
  'scan.startOver': 'Zacznij od nowa',
  'scan.pageAlt': 'Strona {n}',
  'scan.pageN': 'Strona {n}',
  'scan.remove': 'Usuń stronę {n}',
  'scan.addFromPhotos': 'Dodaj ze zdjęć',
  'scan.theseAre': 'Te zdjęcia to',
  'scan.one': 'Jeden dokument',
  'scan.separate': 'Osobne dokumenty',
  'documents.one': '{n} dokument',
  'documents.few': '{n} dokumenty',
  'documents.many': '{n} dokumentów',
  'documents.other': '{n} dokumentu',
  'scan.name': 'Nazwa (opcjonalnie)',
  'scan.namePh': 'Bez nazwy dokument dostanie nazwę z datą',
  'scan.save': 'Zapisz w archiwum',
  'scan.saving': 'Zapisywanie',
  'scan.onlyPhotos': 'Tutaj można dodawać tylko zdjęcia. Pliki PDF dodasz w zakładce Dokumenty.',
  'scan.max': 'Skan może mieć najwyżej {n} stron.',
  'scan.already': 'Ten skan był już w archiwum.',
  'scan.saved.one': 'Skan zapisany. Trwa odczytywanie.',
  'scan.saved.few': 'Zapisano {n} skany. Trwa odczytywanie.',
  'scan.saved.many': 'Zapisano {n} skanów. Trwa odczytywanie.',
  'scan.saved.other': 'Zapisano {n} skanu. Trwa odczytywanie.',
  'scan.saveErr': 'Nie udało się zapisać skanu. Sprawdź połączenie i spróbuj ponownie.',

  'ask.title': 'Zapytaj swoje archiwum',
  'ask.intro': 'Odpowiedzi pochodzą z Twoich zeskanowanych dokumentów i każda wskazuje stronę, na której ją znaleziono.',
  'ask.off': 'Pytania nie są jeszcze włączone. Dokumenty możesz nadal znajdować wyszukiwarką w zakładce Dokumenty.',
  'ask.starter1': 'Które faktury trzeba zapłacić w tym miesiącu i na jaką kwotę?',
  'ask.starter2': 'Ile wydaliśmy u każdego dostawcy w tym roku?',
  'ask.starter3': 'Kiedy kończy się umowa najmu biura i jaki jest okres wypowiedzenia?',
  'ask.new': 'Nowe pytanie',
  'ask.past': 'Wcześniejsze rozmowy',
  'ask.deleteConv': 'Usuń rozmowę: {title}',
  'ask.placeholder': 'Wpisz pytanie o swoje dokumenty',
  'ask.inputAria': 'Twoje pytanie',
  'ask.send': 'Wyślij pytanie',
  'ask.looking': 'Przeglądam archiwum',
  'ask.writing': 'Piszę odpowiedź',
  'ask.err': 'Nie udało się uzyskać odpowiedzi.',
  'ask.noAnswer': 'Tym razem nie udało się odpowiedzieć. Spróbuj zapytać ponownie.',
  'ask.noDoc': 'Tej odpowiedzi nie potwierdza żaden dokument.',
  'ask.noDocBody': 'Nie wskazuje żadnej strony z Twojego archiwum, więc nie opieraj się na niej.',
  'ask.numbers.one': 'Jednej liczby nie ma na stronach, które przeczytał asystent:',
  'ask.numbers.few': '{n} liczb nie ma na stronach, które przeczytał asystent:',
  'ask.numbers.many': '{n} liczb nie ma na stronach, które przeczytał asystent:',
  'ask.numbers.other': '{n} liczb nie ma na stronach, które przeczytał asystent:',
  'ask.numbersTail.one': 'Może być wyliczona z innych liczb albo błędna. Sprawdź ją w dokumencie.',
  'ask.numbersTail.few': 'Mogą być wyliczone z innych liczb albo błędne. Sprawdź je w dokumencie.',
  'ask.numbersTail.many': 'Mogą być wyliczone z innych liczb albo błędne. Sprawdź je w dokumencie.',
  'ask.numbersTail.other': 'Mogą być wyliczone z innych liczb albo błędne. Sprawdź je w dokumencie.',
  'ask.where': 'Skąd to wiadomo',
  'ask.sourcePage': '{title}, strona {n}',
  'ask.sourceAria': 'Źródło {n}: {title}, strona {page}',
  'ask.pageUnconfirmed': '(nie udało się potwierdzić strony)',
  'ask.wordsMissing': '(tych dokładnych słów nie ma na tej stronie)',
  'ask.wordsMissingList': 'Przytoczonych słów nie znaleziono na tej stronie. Sprawdź samodzielnie.',
  'peek.title': 'Źródło',
  'peek.page': 'Strona {n}',
  'peek.pageQuote': 'Strona {n}. Słowa, na których opiera się odpowiedź, są zaznaczone.',
  'peek.noPage': 'Ten dokument nie ma strony {n}.',
  'peek.gone': 'Tego dokumentu nie ma już w archiwum.',
  'peek.loading': 'Wczytywanie strony',
  'peek.open': 'Otwórz cały dokument',

  'biz.title': 'O firmie',
  'biz.intro':
    'Informacje o firmie {name}, które asystent powinien znać, gdy odpowiada. Czyta ten tekst i dodane dokumenty, nic więcej.',
  'biz.introGeneric':
    'Informacje o Twojej firmie, które asystent powinien znać, gdy odpowiada. Czyta ten tekst i dodane dokumenty, nic więcej.',
  'biz.label': 'Co asystent powinien wiedzieć',
  'biz.example':
    'Na przykład:\n\nJesteśmy biurem rachunkowym w Gdyni, zatrudniamy 6 osób.\nPełna nazwa: Biuro Rachunkowe Łoś i Wspólnicy sp.j., NIP 586-102-33-47.\nRok obrotowy pokrywa się z kalendarzowym. Kwoty podajemy w PLN.\n„Żuraw” to nasz dostawca materiałów biurowych, Hurtownia Papiernicza Żuraw Sp. z o.o.',
  'biz.help': 'Przydatne: pełna nazwa i NIP, czym się zajmujecie, rok obrotowy, waluta, skrótowe nazwy dostawców i klientów.',
  'biz.save': 'Zapisz informacje',
  'biz.saved': 'Informacje o firmie zapisane.',
  'biz.saveErr': 'Nie udało się zapisać informacji o firmie.',
  'biz.loadErr': 'Nie udało się wczytać informacji o firmie.',
  'biz.howTitle': 'Jak pilnujemy, żeby odpowiedzi trzymały się dokumentów',
  'biz.how1': 'Asystent może zaglądać tylko do tego archiwum. Nie przegląda internetu i nie widzi innych firm.',
  'biz.how2':
    'Ma odpowiadać wyłącznie na podstawie Twoich dokumentów i tej strony, a gdy nie ma w nich odpowiedzi, powiedzieć o tym wprost.',
  'biz.how3':
    'Każda informacja ma żółty znacznik z numerem. Dotknij go, aby zobaczyć stronę i dokładne słowa, z których pochodzi. Słowa, których naprawdę nie ma na tej stronie, są oznaczane.',
  'biz.how4':
    'Liczby, których nie ma na przeczytanych stronach, są wypisane pod odpowiedzią, więc łatwo zauważyć te wyliczone albo błędne.',
}

const dict: Record<Lang, Record<string, string>> = { en, pl }
