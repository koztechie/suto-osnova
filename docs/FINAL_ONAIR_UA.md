# Ефір фіналіста — сценарій та підготовка

Практична підготовка до прямого ефіру Top 3 (**5 листопада 2026, 22:00 за
Києвом**: усі троє фіналістів представляють ідеї журі, відповідають на
питання і дізнаються результат наживо — за оновленням #47166; точний формат
і тривалість прийдуть із повідомленням фіналіста).

Англійський текст нижче — **готовий до зачитування**: короткі речення (до
10 слів), одне поняття в реченні. Поруч — український сенс, щоб ви знали,
що саме кажете. Нічого не вигадуєте в ефірі — читаєте вивчене.

## 1. Що ви НЕ зобов'язані робити

- Не перекладати складні думки наживо — усі відповіді вже написані.
- Не імпровізувати мову — коротке речення краще за довге з помилками.
- Не виправдовуватися за англійську — ніхто не оцінює мову; оцінюють
  проєкт за чотирма критеріями, і вони вже оцінюються з 2 листопада.

## 2. Сценарій виступу (60-70 секунд)

Читайте повільно. Кожне речення — окремий ковток повітря.

| # | Англійською (читати) | Сенс (українською) |
|---|---|---|
| 1 | Hello. My name is Eugene Kozlovsky. | Вітаю. Мене звати Євген Козловський. |
| 2 | I built SUTO OSNOVA — an agent with real cultural taste. | Я створив SUTO OSNOVA — агента зі справжнім культурним смаком. |
| 3 | Today's agents can reason. But when you ask what people love, they guess. | Сучасні агенти вміють міркувати. Але коли запитуєш, що люди люблять, — вони вгадують. |
| 4 | SUTO OSNOVA asks Qloo's taste graph instead — 250 million entities. | Мій агент замість здогадок питає граф смаку Qloo — 250 мільйонів сутностей. |
| 5 | In one request, it returns a full cultural dossier: music, film, food, fashion, visuals. | За один запит він повертає повне культурне досьє: музика, кіно, їжа, мода, візуал. |
| 6 | You can see every Qloo call in the built-in Inspector. Nothing is hidden. | Кожен виклик Qloo видно у вбудованому інспекторі. Нічого не приховано. |
| 7 | It helps festival teams, film studios and editors make decisions they can defend. | Він допомагає командам фестивалів, студіям і редакторам ухвалювати рішення, які можна обґрунтувати. |
| 8 | Built entirely during this contest. Fully public, MIT licensed, 1,200 tests. | Побудовано повністю під час конкурсу. Повністю публічний, ліцензія MIT, 1200 тестів. |
| 9 | I'm happy to take your questions. | Я готовий відповісти на ваші питання. |

Це 9 речень. На спокійному темпі — близько хвилини. Якщо дадуть показувати
екран — після речення 5 зробіть демонстрацію (пункт 3 нижче), потім
речення 6-9.

## 3. Демонстрація (якщо можна показати екран)

Тримайте дві вкладки відкритими ЗАЗДАЛЕГІДЬ (до ефіру):

1. `https://suto-osnova.netlify.app` — і згенерований досьє;
2. інспектор API (кнопка **API Inspector** у шапці).

Порядок дій і те, що говорити:

- «This is the live application.» → («Це живий застосунок») → пресет
  **David Lynch Noir** → Export Markdown.
- «One request — a full dossier.» → («Один запит — повне досьє»).
- Увімкните режим Experiential, якір **Glastonbury Festival** →
  «For live events: resonance, curation, audience.» («Для живих подій:
  резонанс, кураторство, аудиторія»).
  **НІКОЛИ не натискайте пресет «Ambient Festival» в ефірі** — він зараз
  віддає типізовану помилку `no_usable_signal`
  (задокументовано в [HOSTING_STABILITY.md](HOSTING_STABILITY.md)).
- Відкрийте **API Inspector**: «Every raw Qloo call, right here.» («Кожен
  сирий виклик Qloo — ось тут»).

## 4. Питання журі — готові відповіді (8 штук)

Читайте відповідь НАВІТЬ якщо зрозуміли питання — коротко і точно.
Порядок критеріїв має значення: якщо бали нічия, судді порівнюють за ПЕРШИМ
критерієм — **Technological Implementation**. Тому на питання «чому саме ви»
починайте з технічної глибини (рядок "Why should you win?" у таблиці).

| Питання (так пролунає) | Що питають (українською) | Відповідь (читати англійською) |
|---|---|---|
| Where exactly do you use Qloo? | Де саме використовуєш Qloo? | Four endpoints: search, insights, tags, audiences. The Inspector shows every call. |
| Would it work without Qloo? | А без Qloo працювало б? | No. If Qloo cannot answer, my agent refuses. It never invents taste. |
| Who pays for this? | Хто за це платить? | Festival teams, film studios and editorial curators. It saves hours of research. |
| What did you build in the hackathon? | Що ти побудував під час хакатону? | Everything. The first commit is October 15. Nothing existed before. |
| How do you know it works? | Звідки відомо, що воно працює? | Over 1,200 tests on every push, plus live checks against the real API. |
| Why is this idea non-obvious? | Чому ідея незвична? | Most entries ask a model to sound cultural. Mine measures taste first. The model only explains measured numbers. |
| What's next after the hackathon? | Що далі? | More presets for events and studios, an MCP server for any agent — and the same layer already covers dining and rooms. |
| Are you a team? | Ви команда? | One engineer: me. 199 commits, full history public. |
| Why should you win? | Чому маєте виграти? | Implementation depth first: four Qloo endpoints, one hardened transport, 1,200 tests, provenance on screen. |

## 5. Рятувальні фрази (якщо не розчули або застрягли)

| Англійською | Сенс |
|---|---|
| Could you repeat the question, please? | Повторіть питання, будь ласка. |
| Let me answer in two short sentences. | Дозвольте відповісти двома короткими реченнями. |
| Let me show you on screen — it's clearer. | Дозвольте покажу на екрані — так зрозуміліше. |
| That's a great question. The short answer: the graph decides, not the model. | Гарне питання. Коротко: вирішує граф, а не модель. |

## 6. Вимова складних слів (прочитайте вголос по 3 рази)

| Слівко | Як читати |
|---|---|
| Qloo | **КЛУ** (як «клуб», але з довгим «у») |
| dossier | **ДОС-ЙЕЙ** (два склади, наголос на другому) |
| endpoints | **ЕНД-ПОІНТС** |
| curator / curators | **К'ЮРЕЙТОР** / **К'ЮРЕЙТОРЗ** |
| graph | **ГРЕФ** (коротке «е», без «аф» у кінці) |
| Kozlovsky | **КОЗЛОВСКІ** (як українською, тільки «кі» замість «ий») |
| SUTO OSNOVA | **СУТО ОСНОВА** (як українською) |

## 7. Технічний чек-лист перед ефіром

- [ ] Мікрофон перевірений (навушники з мікрофоном краще за вбудований).
- [ ] Світло спереду, обличчя не у тіні; тиха кімната.
- [ ] Дві вкладки готові: сайт із згенерованим досьє + API Inspector.
- [ ] Сценарій (цей файл) роздрукований або відкритий ПОРУЧ із відеоокном
      — дивитися в текст нормально, ніхто не бачить вашого екрана, окрім
      того, що ви самі показуєте.
- [ ] Проговорити сценарій вголос **3 рази** ввечері перед ефіром і один
      раз вранці. 9 речень — це 10 хвилин практики.
- [ ] Резервний план: якщо інтернет пливе — «I'm on a wired connection,
      one second.» («Я на дротовому з'єднанні, секунду.»)

## 8. Після ефіру

- Результат оголошують наживо того ж дня (**5 листопада, 22:00 Київ**).
- Деталі логістики прийдуть із повідомленням фіналіста — прочитайте його
  уважно (там буде час, посилання на ефір і вимоги до підготовки).
- Якщо виграли — одразу до грошей і документів: розділ *If you win* у
  [SUBMISSION_DRAFT.md](SUBMISSION_DRAFT.md) (форми за 10 робочих днів,
  W-8BEN, дедлайн-приклад 20.11.2026).

Нагадування по суті: до ефіру вас привели робота, репо і опис — вони вже
оцінюються з 2 листопада. Ефір — це показати те, що вже зроблено, і
відповісти на 4-6 коротких питань за готовими відповідями.
