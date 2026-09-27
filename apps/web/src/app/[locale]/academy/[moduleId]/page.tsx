import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  CheckCircle,
  LightbulbIcon,
  AlertCircle,
  FileText,
  MessageSquare,
  Search,
  Linkedin,
  Target,
  TrendingUp,
  Sparkles,
} from 'lucide-react'

// Module content data
const moduleContent: Record<
  string,
  {
    title: string
    description: string
    duration: string
    difficulty: string
    icon: any
    color: string
    sections: Array<{
      title: string
      content: string[]
      tips?: string[]
      warnings?: string[]
    }>
    nextModule?: string
    prevModule?: string
  }
> = {
  'cv-basics': {
    title: 'Ako napísať perfektný životopis',
    description:
      'Naučte sa vytvoriť profesionálny CV, ktorý zaujme recruiterov a prejde cez ATS systémy.',
    duration: '15 min',
    difficulty: 'Začiatočník',
    icon: FileText,
    color: 'bg-blue-500',
    prevModule: undefined,
    nextModule: 'cover-letter',
    sections: [
      {
        title: 'Prečo je CV také dôležité',
        content: [
          'Váš životopis je prvým dojmom, ktorý o vás zamestnávateľ získa. V priemere strávi recruiter len 6-7 sekúnd prezeraním jedného CV. Preto je kľúčové, aby váš životopis okamžite zaujal.',
          'Moderné firmy používajú ATS (Applicant Tracking Systems) - softvér, ktorý automaticky filtruje životopisy. Ak váš CV nie je optimalizovaný, môže byť vyradený ešte predtým, než ho človek uvidí.',
        ],
        tips: [
          'Prispôsobte CV každej pozícii, na ktorú sa hlásite',
          'Používajte kľúčové slová z pracovného inzerátu',
        ],
      },
      {
        title: 'Štruktúra profesionálneho CV',
        content: [
          '**Kontaktné údaje** - Meno, telefón, email, LinkedIn, prípadne portfólio. Adresa nie je nutná.',
          '**Profesionálny súhrn** - 2-3 vety zhŕňajúce vaše skúsenosti a ciele. Toto je najčítanejšia časť!',
          '**Pracovné skúsenosti** - Chronologicky od najnovšej. Pre každú pozíciu uveďte merateľné úspechy.',
          '**Vzdelanie** - Relevantné vzdelanie a certifikáty.',
          '**Zručnosti** - Technické aj mäkké zručnosti relevantné pre pozíciu.',
        ],
        tips: [
          'Používajte akčné slovesá: vytvoril, implementoval, zvýšil, optimalizoval',
          'Kvantifikujte úspechy: "zvýšil predaj o 25%"',
        ],
      },
      {
        title: 'Časté chyby, ktorým sa vyhnúť',
        content: [
          '**Príliš dlhé CV** - Ideálne 1-2 strany. Pre juniora stačí 1 strana.',
          '**Gramatické chyby** - Nechajte si CV skontrolovať. Chyby pôsobia neprofesionálne.',
          '**Nekonzistentné formátovanie** - Používajte jednotný štýl v celom dokumente.',
          '**Irelevantné informácie** - Nepíšte o hobby, ak nesúvisí s pozíciou.',
          '**Klamstvo** - Nikdy neklamte. Na pohovore sa to odhalí.',
        ],
        warnings: [
          'Nepoužívajte fotku, ak to nie je bežné vo vašej krajine',
          'Vynechajte osobné údaje ako vek alebo rodinný stav',
        ],
      },
      {
        title: 'ATS optimalizácia',
        content: [
          'ATS systémy skenujú CV a hľadajú kľúčové slová. Tu je ako to využiť:',
          '**Používajte jednoduché formátovanie** - Žiadne tabuľky, obrázky alebo komplikované rozloženia.',
          '**Štandardné názvy sekcií** - "Pracovné skúsenosti", nie "Moja cesta".',
          '**Kľúčové slová** - Používajte rovnaké výrazy ako sú v inzeráte.',
          '**Formát súboru** - PDF alebo .docx. Nikdy nie obrázok.',
        ],
        tips: [
          'Väčšina ATS číta zhora nadol, zľava doprava',
          'Umiestnite najdôležitejšie informácie na začiatok',
        ],
      },
    ],
  },
  'cover-letter': {
    title: 'Motivačný list, ktorý predáva',
    description: 'Naučte sa písať motivačné listy, ktoré vás odlíšia od ostatných kandidátov.',
    duration: '12 min',
    difficulty: 'Začiatočník',
    icon: MessageSquare,
    color: 'bg-green-500',
    prevModule: 'cv-basics',
    nextModule: 'job-search',
    sections: [
      {
        title: 'Prečo písať motivačný list',
        content: [
          'Motivačný list je vaša príležitosť prerozprávať príbeh, ktorý CV nemôže povedať. Je to priestor na vysvetlenie vašej motivácie a ukázanie osobnosti.',
          'Aj keď niektoré firmy motivačné listy nečítajú, tie ktoré áno, im prikladajú veľkú váhu. Kvalitný motivačný list vás môže odlíšiť od kandidátov s podobným CV.',
        ],
        tips: ['Vždy napíšte motivačný list, ak nie je výslovne uvedené, že ho nepotrebujete'],
      },
      {
        title: 'Štruktúra motivačného listu',
        content: [
          '**Úvod (1 odstavec)** - Zaujmite pozornosť. Uveďte pozíciu a krátky "hook" - prečo ste ideálny kandidát.',
          '**Telo (2-3 odstavce)** - Rozviňte 2-3 kľúčové skúsenosti alebo úspechy. Prepojte ich s požiadavkami pozície.',
          '**Záver (1 odstavec)** - Zosumarizujte, prečo ste správna voľba. Vyjadrite nadšenie a zahrňte výzvu k akcii.',
        ],
        tips: [
          'Celková dĺžka by mala byť 250-400 slov',
          'Každý odstavec by mal mať jeden hlavný bod',
        ],
      },
      {
        title: 'Personalizácia je kľúč',
        content: [
          'Generický motivačný list je horšie než žiadny. Vždy personalizujte:',
          '**Adresujte konkrétnej osobe** - Ak neviete meno, zistite ho na LinkedIn.',
          '**Spomeňte firmu menom** - A ukážte, že ste si urobili výskum.',
          '**Prepojte svoje skúsenosti** - S konkrétnymi požiadavkami z inzerátu.',
          '**Ukážte nadšenie** - Pre danú firmu a pozíciu.',
        ],
        warnings: [
          'Nikdy neposielajte rovnaký list na viac pozícií',
          'Skontrolujte, či ste zmenili všetky názvy firiem',
        ],
      },
      {
        title: 'Storytelling technika',
        content: [
          'Najlepšie motivačné listy rozprávajú príbeh. Namiesto "mám 5 rokov skúseností" skúste:',
          '"Keď som pred 5 rokmi začínal v marketingu, môj prvý projekt bol malá kampaň pre lokálny startup. Dnes vediem tím, ktorý spravuje rozpočty v miliónoch..."',
          'Príbeh zaujme viac ako suché fakty a recruiteri si ho zapamätajú.',
        ],
        tips: ['Používajte konkrétne príklady', 'Ukážte transformáciu alebo rast'],
      },
    ],
  },
  'job-search': {
    title: 'Efektívne hľadanie práce',
    description: 'Stratégie a techniky pre systematické hľadanie vysnívanej práce.',
    duration: '18 min',
    difficulty: 'Začiatočník',
    icon: Search,
    color: 'bg-purple-500',
    prevModule: 'cover-letter',
    nextModule: 'linkedin',
    sections: [
      {
        title: 'Vytvorte si stratégiu',
        content: [
          'Hľadanie práce bez stratégie je ako hľadanie ihly v kope sena. Začnite tým, že si definujete:',
          '**Čo hľadáte** - Typ pozície, odvetvie, veľkosť firmy.',
          '**Kde hľadáte** - Geografická lokalita, možnosť remote práce.',
          '**Čo ponúkate** - Vaše jedinečné zručnosti a skúsenosti.',
          '**Aký je váš časový plán** - Kedy potrebujete novú prácu?',
        ],
        tips: ['Vytvorte si tabuľku na sledovanie prihlášok', 'Stanovte si denné/týždenné ciele'],
      },
      {
        title: 'Kde hľadať prácu',
        content: [
          '**Job portály** - LinkedIn, Profesia, Kariéra.sk, Indeed. Nastavte si upozornenia.',
          '**Firemné stránky** - Sledujte kariérne sekcie firiem, ktoré vás zaujímajú.',
          '**Networking** - 60-80% pozícií sa nikdy neinzeruje. Networking je kľúčový.',
          '**Recruiteri** - Vytvorte si vzťahy s recruitermi vo vašom odbore.',
          '**Sociálne siete** - LinkedIn, ale aj Twitter a Facebook skupiny.',
        ],
      },
      {
        title: 'Skrytý trh práce',
        content: [
          'Väčšina pozícií sa nikdy verejne neinzeruje. Ako sa k nim dostať?',
          '**Informatívne rozhovory** - Požiadajte ľudí v odbore o 20-minútový rozhovor.',
          '**Priame oslovenie** - Napíšte hiring managerovi, aj keď firma neinzeruje.',
          '**Alumni siete** - Spojte sa s absolventmi vašej školy.',
          '**Profesijné združenia** - Buďte aktívny v odborných komunitách.',
        ],
        tips: [
          'Pri informatívnych rozhovoroch nepýtajte priamo prácu',
          'Budujte vzťahy dlhodobo, nie len keď potrebujete prácu',
        ],
      },
      {
        title: 'Organizácia a sledovanie',
        content: [
          'Sledujte všetky svoje prihlášky v tabuľke alebo v aplikácii:',
          '**Firma a pozícia** - Kde ste sa prihlásili.',
          '**Dátum prihlášky** - Kedy ste to poslali.',
          '**Kontaktná osoba** - Ak poznáte recruitera.',
          '**Status** - Odoslané, pohovor naplánovaný, zamietnuté, atď.',
          '**Poznámky** - Čo ste sa naučili, followup úlohy.',
        ],
        tips: [
          'Nastavte si pripomienky na followup po 1-2 týždňoch',
          'Analyzujte, ktoré kanály prinášajú najlepšie výsledky',
        ],
      },
    ],
  },
  linkedin: {
    title: 'LinkedIn ako profesionál',
    description: 'Optimalizujte svoj LinkedIn profil a budujte svoju profesionálnu sieť.',
    duration: '20 min',
    difficulty: 'Stredne pokročilý',
    icon: Linkedin,
    color: 'bg-sky-500',
    prevModule: 'job-search',
    nextModule: 'interview-prep',
    sections: [
      {
        title: 'Optimalizácia profilu',
        content: [
          'Váš LinkedIn profil je váš online životopis. Optimalizujte každú sekciu:',
          '**Profilová fotka** - Profesionálna fotka s priateľským úsmevom. Fotky zvyšujú návštevnosť o 21x.',
          '**Banner** - Využite na ukázanie vašej oblasti alebo značky.',
          '**Headline** - Nie len "Software Developer". Pridajte hodnotu: "Software Developer | Pomáham startupom škálovať".',
          '**About sekcia** - 3-5 odstavcov o vašich skúsenostiach, záujmoch a cieľoch. Píšte v prvej osobe.',
        ],
        tips: [
          'Používajte kľúčové slová, aby vás recruiteri našli',
          'Zapnite "Open to Work" badge, ak aktívne hľadáte',
        ],
      },
      {
        title: 'Budovanie siete',
        content: [
          '**Kvalita > kvantita** - Spojte sa s ľuďmi, s ktorými máte skutočný vzťah.',
          '**Personalizované pozvánky** - Vždy napíšte krátku správu, prečo sa chcete spojiť.',
          '**Sledujte influencerov** - Vo vašom odbore, ale aj komentujte ich príspevky.',
          '**Odpovedajte na správy** - LinkedIn meria vašu responzívnosť.',
        ],
      },
      {
        title: 'Content stratégia',
        content: [
          'Byť aktívny na LinkedIn výrazne zvyšuje vašu viditeľnosť:',
          '**Zdieľajte know-how** - Čo ste sa naučili vo vašej práci?',
          '**Komentujte** - Zmysluplné komentáre vás zviditeľnia.',
          '**Postujte pravidelne** - Aspoň 1-2x týždenne.',
          '**Engagujte sa** - Lajkujte a zdieľajte príspevky vašej siete.',
        ],
        tips: [
          'Najlepší čas na posting je ráno v pracovných dňoch',
          'Posty s obrázkami majú 2x väčší dosah',
        ],
      },
      {
        title: 'Oslovenie recruiterov',
        content: [
          'LinkedIn je plný recruiterov. Ako ich osloviť:',
          '**Nečakajte, že vás nájdu** - Buďte proaktívni.',
          '**Personalizované správy** - Ukážte, že ste si pozreli ich profil.',
          '**Buďte konkrétni** - Čo hľadáte, aké sú vaše skúsenosti.',
          '**Followup** - Ak neodpovedia, napíšte o týždeň znova.',
        ],
        warnings: [
          'Neposielajte generické správy "Hľadám prácu"',
          'Nebuďte agresívni ak neodpovedia',
        ],
      },
    ],
  },
  'interview-prep': {
    title: 'Príprava na pohovor',
    description: 'Komplexný sprievodca prípravou na pracovný pohovor - od výskumu po oblečenie.',
    duration: '25 min',
    difficulty: 'Stredne pokročilý',
    icon: Target,
    color: 'bg-orange-500',
    prevModule: 'linkedin',
    nextModule: 'salary-negotiation',
    sections: [
      {
        title: 'Výskum pred pohovorom',
        content: [
          'Dôkladný výskum je základ úspechu na pohovore:',
          '**O firme** - Produkty/služby, história, hodnoty, kultúra, nedávne novinky.',
          '**O pozícii** - Detailne si prečítajte popis, identifikujte kľúčové požiadavky.',
          '**O ľuďoch** - LinkedIn profily tých, s kým budete hovoriť.',
          '**O odvetví** - Trendy, konkurencia, výzvy.',
        ],
        tips: [
          'Pripravte si 3-5 otázok na firmu',
          'Spomeňte niečo konkrétne o firme počas pohovoru',
        ],
      },
      {
        title: 'Časté otázky a ako odpovedať',
        content: [
          '**"Povedzte mi o sebe"** - 2-minutový pitch: kto ste, čo ste dosiahli, prečo ste tu.',
          '**"Prečo chcete túto pozíciu?"** - Prepojte vaše ciele s tým, čo firma ponúka.',
          '**"Aké sú vaše silné stránky?"** - 2-3 relevatné zručnosti s príkladmi.',
          '**"Aké sú vaše slabé stránky?"** - Skutočná slabina + čo robíte pre zlepšenie.',
          '**"Kde sa vidíte o 5 rokov?"** - Ukážte ambície, ale aj lojalitu.',
        ],
      },
      {
        title: 'STAR metóda',
        content: [
          'Pre behaviorálne otázky ("Povedzte mi o situácii, keď...") použite STAR:',
          '**Situation** - Popíšte kontext a pozadie.',
          '**Task** - Aká bola vaša úloha alebo zodpovednosť?',
          '**Action** - Čo konkrétne ste urobili?',
          '**Result** - Aký bol výsledok? Ideálne s číslami.',
        ],
        tips: ['Pripravte si 5-7 STAR príbehov z vašej kariéry', 'Cvičte nahlas, nie len v hlave'],
      },
      {
        title: 'Deň pohovoru',
        content: [
          '**Príďte skôr** - 10-15 minút pred začiatkom.',
          '**Oblečenie** - Radšej formálnejšie. Ak neviete, opýtajte sa recruitera.',
          '**Body language** - Pevný stisk ruky, očný kontakt, úsmev.',
          '**Aktívne počúvanie** - Neprerušujte, pýtajte sa doplňujúce otázky.',
          '**Poznámky** - Je OK si robiť poznámky počas pohovoru.',
        ],
        warnings: [
          'Nevyrušujte telefónom - vypnite ho',
          'Nekritizujte predchádzajúceho zamestnávateľa',
        ],
      },
    ],
  },
  'salary-negotiation': {
    title: 'Vyjednávanie o plate',
    description: 'Naučte sa sebavedomé vyjednávať o plate a benefitoch.',
    duration: '15 min',
    difficulty: 'Pokročilý',
    icon: TrendingUp,
    color: 'bg-emerald-500',
    prevModule: 'interview-prep',
    nextModule: 'personal-brand',
    sections: [
      {
        title: 'Príprava je všetko',
        content: [
          'Pred akýmkoľvek vyjednávaním si urobte domácu úlohu:',
          '**Výskum miezd** - Glassdoor, Platy.sk, LinkedIn Salary, prieskumy.',
          '**Poznajte svoju hodnotu** - Aké sú vaše unikátne skúsenosti a zručnosti?',
          '**Stanovte si rozsah** - Minimum, ideál, maximum.',
          '**Zvážte celý balík** - Nie len základnú mzdu, ale aj bonusy, equity, benefity.',
        ],
        tips: ['Prvý kto povie číslo, obvykle prehráva', 'Ak vás tlačia, dajte rozsah'],
      },
      {
        title: 'Kedy vyjednávať',
        content: [
          '**Počkajte na ponuku** - Vyjednávajte až keď máte oficiálnu ponuku.',
          '**Neskákajte na prvú ponuku** - Takmer vždy je priestor na vyjednávanie.',
          '**Dajte si čas** - Je OK požiadať o 24-48 hodín na rozmyslenie.',
          '**Neukazujte zúfalstvo** - Aj keď prácu nutne potrebujete.',
        ],
      },
      {
        title: 'Techniky vyjednávania',
        content: [
          '**Anchor vysoký** - Ak musíte povedať číslo prvý, začnite vyššie.',
          '**Používajte "my"** - "Ako sa môžeme dostať bližšie k X?" namiesto "Ja chcem X".',
          '**Silence is golden** - Po vašej požiadavke buďte ticho. Nechajte ich odpovedať.',
          '**Buďte pripravení odísť** - Najväčšia vyjednávacia sila.',
          '**Win-win mindset** - Cieľom nie je "vyhrať", ale nájsť riešenie pre obe strany.',
        ],
        tips: [
          'Vyjednávajte e-mailom, ak nie ste silný vo verbálnom vyjednávaní',
          'Majte alternatívy (iné ponuky)',
        ],
      },
      {
        title: 'Čo ešte vyjednávať',
        content: [
          'Ak firma nemôže zvýšiť plat, skúste:',
          '**Sign-on bonus** - Jednorazový bonus pri nástupe.',
          '**Flexibilita** - Remote práca, flexibilný pracovný čas.',
          '**Dovolenka** - Viac dní voľna.',
          '**Vzdelávanie** - Kurzy, konferencie, certifikáty.',
          '**Review za 6 mesiacov** - Ak teraz nemôžu, kedy môžu?',
        ],
      },
    ],
  },
  'personal-brand': {
    title: 'Budovanie osobnej značky',
    description: 'Vytvorte si silnú profesionálnu značku, ktorá vás odlíši na trhu práce.',
    duration: '22 min',
    difficulty: 'Pokročilý',
    icon: Sparkles,
    color: 'bg-pink-500',
    prevModule: 'salary-negotiation',
    nextModule: 'career-change',
    sections: [
      {
        title: 'Čo je osobná značka',
        content: [
          'Vaša osobná značka je to, čo o vás ľudia hovoria, keď nie ste v miestnosti. Je to kombinácia:',
          '**Vašich zručností** - V čom ste expertom?',
          '**Vašich hodnôt** - Čo je pre vás dôležité?',
          '**Vášho príbehu** - Ako ste sa dostali tam, kde ste?',
          '**Vašej prezentácie** - Ako komunikujete navonok?',
        ],
      },
      {
        title: 'Online prítomnosť',
        content: [
          'V digitálnom veku vás ľudia googlia. Čo nájdu?',
          '**LinkedIn** - Základný pilier profesionálnej prítomnosti.',
          '**Osobný web/portfólio** - Ukážte svoju prácu.',
          '**GitHub/Dribbble/Behance** - Platform relevantný pre váš odbor.',
          '**Sociálne siete** - Konzistentný profesionálny obraz.',
          '**Blog/Newsletter** - Zdieľajte svoje znalosti.',
        ],
        tips: [
          'Google si sám seba a opravte problematické výsledky',
          'Kúpte si doménu so svojím menom',
        ],
      },
      {
        title: 'Thought leadership',
        content: [
          'Staňte sa autoritou vo vašom odbore:',
          '**Píšte články** - Na LinkedIn, Medium, vlastný blog.',
          '**Prednášajte** - Na meetupoch, konferenciách, webinároch.',
          '**Učte** - Mentoring, kurzy, tutoriály.',
          '**Komentujte aktuálne témy** - Vaša perspektíva na trendy v odbore.',
        ],
      },
      {
        title: 'Konzistencia a autenticita',
        content: [
          '**Buďte konzistentní** - Rovnaký vizuál, tón, messaging naprieč platformami.',
          '**Buďte autentickí** - Nesnažte sa byť niekto iný. Ľudia vycítia falošnosť.',
          '**Buďte trpezliví** - Budovanie značky trvá mesiace a roky.',
          '**Buďte aktívni** - Pravidelnosť je kľúčová.',
        ],
        warnings: [
          'Nezdieľajte kontroverzné politické názory pod profesionálnym profilom',
          'Držte sa ďaleko od online hádok',
        ],
      },
    ],
  },
  'career-change': {
    title: 'Zmena kariéry krok za krokom',
    description: 'Praktický sprievodca pre tých, ktorí chcú zmeniť odbor alebo profesiu.',
    duration: '30 min',
    difficulty: 'Pokročilý',
    icon: Target,
    color: 'bg-amber-500',
    prevModule: 'personal-brand',
    nextModule: undefined,
    sections: [
      {
        title: 'Je zmena kariéry pre vás?',
        content: [
          'Predtým než začnete, položte si tieto otázky:',
          '**Prečo chcete zmenu?** - Únava z práce? Túžba po novom? Finančné dôvody?',
          '**Čo vás baví?** - Aké aktivity vás napĺňajú?',
          '**Čo ste ochotní obetovať?** - Čas, peniaze, status?',
          '**Aký je váš časový horizont?** - Niektoré zmeny trvajú roky.',
        ],
        tips: [
          'Skúste si novú kariéru pred plným commitmentom',
          'Hovorte s ľuďmi, ktorí už robia to, čo chcete',
        ],
      },
      {
        title: 'Identifikujte transferable skills',
        content: [
          'Aj keď meníte odbor, veľa zručností sa prenáša:',
          '**Mäkké zručnosti** - Komunikácia, leadership, riešenie problémov.',
          '**Technické zručnosti** - Excel, prezentácie, analýza dát.',
          '**Odborové znalosti** - Regulácie, procesy, kontakty.',
          'Urobte si inventúru všetkých zručností a identifikujte tie prenositeľné.',
        ],
      },
      {
        title: 'Plán prekvalifikácie',
        content: [
          '**Identifikujte medzery** - Čo vám chýba pre novú kariéru?',
          '**Vzdelávanie** - Kurzy, certifikáty, bootcampy, formálne vzdelanie.',
          '**Prax** - Dobrovoľníctvo, freelance projekty, stáže.',
          '**Side projekty** - Budujte portfólio ešte pred zmenou.',
          '**Networking** - Budujte kontakty v novom odbore.',
        ],
        tips: [
          'Začnite sa vzdelávať popri súčasnej práci',
          'Zvážte postupný prechod namiesto skok',
        ],
      },
      {
        title: 'Prezentácia zmeny',
        content: [
          'Ako vysvetliť zmenu kariéry na pohovore:',
          '**Pozitívny framing** - Nejdete OD niečoho, idete K niečomu.',
          '**Príbeh** - Vysvetlite logiku vašej cesty.',
          '**Dôkazy** - Ukážte, že to myslíte vážne (vzdelanie, projekty).',
          '**Nadšenie** - Vaša energia presvedčí viac ako životopis.',
        ],
        warnings: ['Nekritizujte svoj predchádzajúci odbor', 'Nebuďte defenzívni ohľadom zmeny'],
      },
    ],
  },
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; moduleId: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'pageMetadata' })
  const academyModule = moduleContent[params.moduleId]
  if (!academyModule) {
    return { title: t('moduleNotFound') }
  }
  return {
    title: t('moduleTitle', { title: academyModule.title }),
    description: academyModule.description,
  }
}

export default async function AcademyModulePage({
  params,
}: {
  params: { locale: string; moduleId: string }
}) {
  const academyModule = moduleContent[params.moduleId]

  if (!academyModule) {
    notFound()
  }

  const Icon = academyModule.icon

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Header */}
      <div className="border-b bg-primary/5">
        <div className="container mx-auto px-4 py-8">
          <Button variant="ghost" asChild className="mb-4">
            <Link href={`/${params.locale}/academy`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Späť na Akadémiu
            </Link>
          </Button>

          <div className="flex items-start gap-4">
            <div className={`rounded-xl p-4 ${academyModule.color} text-white`}>
              <Icon className="h-8 w-8" />
            </div>
            <div>
              <Badge variant="outline" className="mb-2">
                {academyModule.difficulty}
              </Badge>
              <h1 className="text-3xl font-bold md:text-4xl">{academyModule.title}</h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">{academyModule.description}</p>
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{academyModule.duration} čítania</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="mx-auto max-w-3xl">
          {academyModule.sections.map((section, index) => (
            <div key={index} className="mb-12">
              <h2 className="mb-4 text-2xl font-bold">{section.title}</h2>

              <div className="space-y-4">
                {section.content.map((paragraph, pIndex) => (
                  <p key={pIndex} className="leading-relaxed text-muted-foreground">
                    {paragraph.split('**').map((part, i) =>
                      i % 2 === 1 ? (
                        <strong key={i} className="text-foreground">
                          {part}
                        </strong>
                      ) : (
                        part
                      ),
                    )}
                  </p>
                ))}
              </div>

              {section.tips && section.tips.length > 0 && (
                <Card className="mt-6 border-primary/20 bg-primary/5">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <LightbulbIcon className="mt-0.5 h-5 w-5 text-primary" />
                      <div>
                        <p className="mb-2 text-sm font-semibold">Tipy</p>
                        <ul className="space-y-1">
                          {section.tips.map((tip, tIndex) => (
                            <li
                              key={tIndex}
                              className="flex items-start gap-2 text-sm text-muted-foreground"
                            >
                              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                              {tip}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {section.warnings && section.warnings.length > 0 && (
                <Card className="mt-6 border-destructive/20 bg-destructive/5">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
                      <div>
                        <p className="mb-2 text-sm font-semibold">Pozor</p>
                        <ul className="space-y-1">
                          {section.warnings.map((warning, wIndex) => (
                            <li key={wIndex} className="text-sm text-muted-foreground">
                              {warning}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {index < academyModule.sections.length - 1 && <Separator className="mt-8" />}
            </div>
          ))}

          {/* Navigation */}
          <div className="flex items-center justify-between border-t pt-8">
            {academyModule.prevModule ? (
              <Button variant="outline" asChild>
                <Link href={`/${params.locale}/academy/${academyModule.prevModule}`}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Predchádzajúci modul
                </Link>
              </Button>
            ) : (
              <div />
            )}

            {academyModule.nextModule ? (
              <Button asChild>
                <Link href={`/${params.locale}/academy/${academyModule.nextModule}`}>
                  Ďalší modul
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href={`/${params.locale}/jobs`}>
                  Nájsť prácu
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
