"""Question bank for the level test — the check that stands between a learner
and a higher CEFR level.

It is also onboarding's placement: a new learner takes the test at the
level they believe they are at, so the first level is earned the same way as
every later one. (Onboarding used to have its own twenty fixed questions
across all six levels — too few to gate a level on, since anyone could learn
them.) Each level has its own pool — grammar, vocabulary and short reading —
and a test draws from it at random with the choices shuffled.
B2 and above also get vocabulary questions generated from the lexicon
(services/level_test.py), so no two tests are the same.

Written to test the level named, not to trick: exactly one choice is right,
and the others are the mistakes a learner at that level really makes. Each
entry lists the correct answer FIRST; the order shown is shuffled per test.

Like the screener, this is a practical check, not a validated CEFR exam.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class BankQuestion:
    id: str
    level: str
    #: "grammar" | "vocabulary" | "reading"
    skill: str
    prompt: str
    #: The correct answer first; shuffled when served.
    choices: tuple[str, str, str, str]
    #: A short text the question is about (reading questions).
    passage: str | None = None


def _bank(level: str, items: list[tuple]) -> list[BankQuestion]:
    out = []
    counts: dict[str, int] = {}
    for item in items:
        skill, prompt, choices = item[0], item[1], item[2]
        passage = item[3] if len(item) > 3 else None
        counts[skill] = counts.get(skill, 0) + 1
        out.append(
            BankQuestion(
                id=f"{level.lower()}-{skill[0]}{counts[skill]}",
                level=level,
                skill=skill,
                prompt=prompt,
                choices=tuple(choices),  # type: ignore[arg-type]
                passage=passage,
            )
        )
    return out


G, V, R = "grammar", "vocabulary", "reading"

A1 = _bank("A1", [
    (G, "My brother ___ twelve years old.", ("is", "are", "am", "be")),
    (G, "___ you like coffee?", ("Do", "Does", "Are", "Is")),
    (G, "She ___ in London.", ("lives", "live", "living", "is live")),
    (G, "There ___ a cat under the table.", ("is", "are", "am", "be")),
    (G, "I can ___ the piano.", ("play", "plays", "playing", "to play")),
    (G, "These ___ my shoes.", ("are", "is", "am", "be")),
    (G, "We have lunch ___ one o'clock.", ("at", "in", "on", "for")),
    (G, "My birthday is ___ May.", ("in", "at", "on", "to")),
    (G, "He ___ not like fish.", ("does", "do", "is", "are")),
    (G, "I eat ___ apple every day.", ("an", "a", "many", "two")),
    (G, "Where ___ your parents from?", ("are", "is", "am", "does")),
    (G, "That is Maria's bag. It is ___ bag.", ("her", "she", "hers", "his")),
    (G, "I ___ got two sisters.", ("have", "has", "am", "is")),
    (G, "How ___ is this T-shirt? — It's ten dollars.", ("much", "many", "old", "long")),
    (V, "Monday, Tuesday, ___, Thursday", ("Wednesday", "Friday", "Sunday", "Saturday")),
    (V, "Your mother's mother is your ___.", ("grandmother", "aunt", "sister", "daughter")),
    (V, "You use a ___ to write.", ("pen", "cup", "bed", "shoe")),
    (V, "It's cold outside. Put on your ___.", ("coat", "glasses", "ring", "watch")),
    (V, "The opposite of 'big' is ___.", ("small", "tall", "long", "old")),
    (V, "I'm hungry. I want to ___.", ("eat", "sleep", "swim", "read")),
    (R, "How does Tom go to work?", ("by bike", "by bus", "by car", "on foot"),
     "Tom is a teacher. He works in a small school. He goes to work by bike every day."),
    (R, "What does Anna do after breakfast?",
     ("She goes to the park.", "She goes to work.", "She goes to bed.", "She has lunch."),
     "Anna gets up at seven o'clock. She has breakfast and then she goes to the park with her dog."),
    (R, "When is the shop closed?", ("on Sundays", "at nine", "on Mondays", "in the morning"),
     "The shop opens at nine and closes at six. It is closed on Sundays."),
    (R, "How old is Leo's brother?", ("five", "ten", "seven", "fifteen"),
     "My name is Leo. I have a sister and a brother. My sister is ten and my brother is five."),
])

A2 = _bank("A2", [
    (G, "Last summer we ___ to Spain.", ("went", "go", "goes", "have gone")),
    (G, "Look! It ___.", ("is raining", "rains", "rained", "rain")),
    (G, "My house is ___ than yours.", ("bigger", "more big", "biggest", "the bigger")),
    (G, "This is the ___ film I have ever seen.", ("best", "better", "good", "most good")),
    (G, "I'm ___ visit my grandmother next weekend.", ("going to", "will to", "go to", "going")),
    (G, "Is there ___ milk in the fridge?", ("any", "some", "many", "a")),
    (G, "She ___ TV when I called her.", ("was watching", "watched", "is watching", "watches")),
    (G, "You ___ wear a seatbelt in the car. It's the law.", ("must", "can", "may", "could")),
    (G, "How many ___ do you drink a day?", ("cups of coffee", "coffee", "cup of coffee", "coffees cup")),
    (G, "I ___ never been to Japan.", ("have", "has", "am", "did")),
    (G, "He speaks English very ___.", ("well", "good", "better", "nice")),
    (G, "Did you ___ the email I sent?", ("get", "got", "gets", "getting")),
    (G, "I don't like him, and he doesn't like ___.", ("me", "I", "my", "mine")),
    (G, "We arrived ___ the airport at midnight.", ("at", "in", "to", "on")),
    (V, "I missed the bus, so I was ___ for work.", ("late", "early", "quick", "ready")),
    (V, "Can you do me a ___?", ("favour", "help", "service", "hand")),
    (V, "A place where you can borrow books is a ___.", ("library", "bookshop", "museum", "bakery")),
    (V, "I'm really ___ — I worked all day.", ("tired", "tiring", "boring", "asleep")),
    (V, "The ___ is lovely today — sunny and warm.", ("weather", "whether", "climate", "temperature")),
    (V, "He ___ his exam because he didn't study.", ("failed", "lost", "missed", "dropped")),
    (R, "Why didn't Kate write sooner?",
     ("She was ill.", "She was on holiday.", "She was busy at work.", "She lost Sam's address."),
     "Dear Sam, thanks for your letter. I'm sorry I didn't write sooner — I was ill last week, "
     "but I'm better now. Let's meet on Saturday. Love, Kate."),
    (R, "Who doesn't need to pay?",
     ("children under 12", "everyone on Mondays", "adults after 5 p.m.", "all visitors"),
     "The museum is open every day from 10 a.m. to 5 p.m., except Mondays. Tickets are free for children under 12."),
    (R, "What did Mark decide to do?",
     ("save money first", "buy a cheaper phone", "borrow money", "buy the phone"),
     "Mark wanted to buy a new phone, but it was too expensive. He decided to save money for three months first."),
    (R, "What caused the problem?", ("the snow", "the concert", "a late taxi", "a lost ticket"),
     "Our train was delayed by two hours because of the snow, so we missed the start of the concert."),
])

B1 = _bank("B1", [
    (G, "If I ___ more money, I would travel the world.", ("had", "have", "will have", "would have")),
    (G, "This bridge ___ in 1890.", ("was built", "built", "is built", "has built")),
    (G, "I ___ here since 2020.", ("have lived", "live", "am living", "lived")),
    (G, "The woman ___ lives next door is a nurse.", ("who", "which", "whose", "what")),
    (G, "He told me that he ___ tired.", ("was", "were", "be", "being")),
    (G, "I ___ play football, but now I prefer tennis.", ("used to", "use to", "was used to", "am used to")),
    (G, "She's not old ___ to drive.", ("enough", "too", "very", "so")),
    (G, "I'm looking forward to ___ you.", ("seeing", "see", "saw", "have seen")),
    (G, "Someone is knocking. It ___ be the postman — he usually comes now.", ("must", "can't", "mustn't", "needn't")),
    (G, "If it rains, we ___ the picnic.", ("will cancel", "would cancel", "cancelled", "had cancelled")),
    (G, "I've finished my homework, but my brother hasn't finished ___.", ("yet", "already", "still", "ever")),
    (G, "Can you tell me where the station ___?", ("is", "is it", "does", "it is")),
    (G, "The film was so ___ that I fell asleep.", ("boring", "bored", "bore", "bores")),
    (G, "Neither my brother ___ my sister can swim.", ("nor", "or", "and", "but")),
    (V, "Could you ___ down the music? I'm trying to sleep.", ("turn", "put", "take", "get")),
    (V, "The company decided to ___ ten new employees.", ("hire", "rent", "borrow", "lend")),
    (V, "It was a hard choice, but in the ___ we chose the smaller flat.", ("end", "finish", "last", "final")),
    (V, "He's very ___: he always tells the truth.", ("honest", "polite", "generous", "patient")),
    (V, "We need to ___ a decision by Friday.", ("make", "do", "have", "get")),
    (V, "Prices have ___ a lot this year.", ("gone up", "grown up", "come up", "taken up")),
    (R, "According to the survey, why do home workers work longer?",
     ("They find it hard to stop.", "They have more tasks.", "They start later.", "Their managers ask them to."),
     "Many people think that working from home saves time. However, a recent survey found that people who "
     "work from home often work longer hours, because they find it hard to stop."),
    (R, "What did the new owners change?",
     ("They added vegetarian dishes.", "They changed the whole menu.", "They moved the café.", "They lowered the prices."),
     "The café on Hill Street has new owners. They kept the old menu but added vegetarian dishes, "
     "and the café is now busier than ever."),
    (R, "Why did Maria take the course?",
     ("to help her get a promotion", "because it was cheap", "because her friend took it", "to change jobs"),
     "Although the course was expensive, Maria decided to take it because it would help her get a promotion."),
    (R, "What happens to books due while the library is closed?",
     ("They can be returned later with no fine.", "They must be returned before 1 March.",
      "They will be collected from readers.", "A smaller fine is paid."),
     "Please note that the library will be closed for repairs from 1 to 14 March. Books due during this "
     "period can be returned when the library reopens, without a fine."),
])

B2 = _bank("B2", [
    (G, "If I had known about the meeting, I ___ it.",
     ("would have attended", "would attend", "attended", "had attended")),
    (G, "I wish I ___ so much last night.", ("hadn't eaten", "didn't eat", "haven't eaten", "wouldn't eat")),
    (G, "He ___ have taken the train; his car is still here.", ("must", "can't", "should", "needn't")),
    (G, "The report ___ by the time the manager arrived.",
     ("had been finished", "was finishing", "has been finished", "had finished")),
    (G, "___ the rain, the match went ahead.", ("Despite", "Although", "However", "Even though")),
    (G, "She denied ___ the money.", ("taking", "to take", "take", "that she take")),
    (G, "It's high time we ___ home.", ("went", "go", "will go", "have gone")),
    (G, "Not only ___ late, but he also forgot the tickets.", ("was he", "he was", "he is", "did he be")),
    (G, "Having ___ the letter, she burst into tears.", ("read", "reading", "to read", "been read")),
    (G, "The more you practise, ___ you become.", ("the better", "better", "the best", "more better")),
    (G, "He is said ___ a fortune in the 1990s.", ("to have made", "to make", "making", "that he made")),
    (G, "By next June, I ___ here for ten years.", ("will have worked", "will work", "am working", "have worked")),
    (V, "The government has ___ a new law to reduce pollution.",
     ("introduced", "invented", "discovered", "produced")),
    (V, "I can't ___ with this noise any longer.", ("put up", "put off", "put out", "put down")),
    (V, "Her performance ___ everyone's expectations.", ("exceeded", "succeeded", "proceeded", "preceded")),
    (V, "Let's ___ the matter at the next meeting.", ("discuss", "discuss about", "talk", "speak")),
    (V, "She was ___ of stealing, but it was never proven.", ("accused", "blamed", "charged", "criticised")),
    (R, "What is the critics' main point?",
     ("The electricity may still come from fossil fuels.", "Electric cars are too expensive.",
      "Electric cars produce emissions on the road.", "Fossil fuels are running out."),
     "While electric cars produce no emissions on the road, critics point out that the electricity they use "
     "is often generated by burning fossil fuels, which reduces their environmental advantage."),
    (R, "What is the author's view of social media?",
     ("It helps people with unusual interests connect.", "It makes people lonelier.",
      "It is mainly used locally.", "It should be regulated."),
     "The author argues that, far from making us lonely, social media allows people with rare interests to "
     "find communities they could never have found locally."),
    (R, "Why did the committee approve the plan?",
     ("The costs were cut.", "They were never sceptical.", "The plan was made bigger.", "The committee was replaced."),
     "Initially sceptical, the committee eventually approved the plan once the costs had been reduced by a third."),
    (R, "How is the latest book different?",
     ("It is considered serious and slow rather than funny.", "It is funnier than before.",
      "It was praised by critics.", "It is shorter than his earlier novels."),
     "Unlike his earlier novels, which were praised for their humour, his latest book has been criticised "
     "as heavy and slow."),
])

C1 = _bank("C1", [
    (G, "Had I known the truth, I ___ differently.", ("would have acted", "will act", "acted", "had acted")),
    (G, "Little ___ that the decision would change his life.", ("did he know", "he knew", "he did know", "knew he")),
    (G, "Under no circumstances ___ the door be left open.", ("should", "ought", "will be", "is")),
    (G, "She acted as though she ___ nothing about it.", ("knew", "knows", "will know", "is knowing")),
    (G, "The proposal, ___ was rejected, would have cost millions.", ("which", "that", "what", "who")),
    (G, "It was not until midnight ___ the results were announced.", ("that", "when", "which", "then")),
    (G, "Were the company ___ its prices, it would lose customers.", ("to raise", "raising", "raise", "raised")),
    (G, "I'd rather you ___ anyone about this.", ("didn't tell", "don't tell", "won't tell", "not tell")),
    (G, "Such ___ the demand that tickets sold out in minutes.", ("was", "were", "is being", "has")),
    (G, "So ___ was the storm that the flights were cancelled.", ("severe", "severely", "severity", "severed")),
    (G, "He is thought ___ the country last week.", ("to have left", "to leave", "leaving", "having left")),
    (G, "Seldom ___ such a convincing argument.", ("have I heard", "I have heard", "I heard", "did I heard")),
    (V, "The minister's remarks ___ a fierce debate.", ("sparked", "lit", "fired", "burned")),
    (V, "The evidence is ___: nobody can argue with it.",
     ("irrefutable", "irreversible", "irrelevant", "irresponsible")),
    (V, "They reached a ___ after hours of negotiation.", ("compromise", "compliment", "complement", "commitment")),
    (V, "Her argument doesn't ___ water.", ("hold", "keep", "carry", "contain")),
    (V, "The project was ___ by delays from the start.", ("plagued", "pleaded", "plugged", "paved")),
    (V, "He tends to ___ the truth when he's nervous.", ("stretch", "extend", "widen", "lengthen")),
    (R, "What do the authors caution?",
     ("The link they found may not be causal.", "Their sample was too small.",
      "They made a calculation error.", "Other studies contradict them."),
     "The study's authors are careful not to overstate their findings: the correlation they observed, they "
     "note, may reflect a third factor rather than any direct effect."),
    (R, "What do the critics object to?",
     ("Decision-makers are no longer accountable.", "The reforms made things slower.",
      "The reforms were too expensive.", "Too many people are involved."),
     "What the reforms gained in efficiency, critics argue, they lost in accountability, since decisions are "
     "now taken by bodies that answer to no one."),
    (R, "What does the writer suggest about the letter?",
     ("Its careful politeness reveals anger.", "It is openly angry.",
      "It was written in a hurry.", "It is sincerely friendly."),
     "Her tone throughout the letter is one of studied politeness, which only makes the underlying anger "
     "more apparent."),
    (R, "What matters most in the novel, according to the text?",
     ("the narrator's changing moods", "its complex plot", "its summary", "its historical setting"),
     "The novel resists easy summary; its plot, such as it is, matters far less than the shifting moods of "
     "its narrator."),
])

C2 = _bank("C2", [
    (G, "Scarcely ___ the house when the phone rang.",
     ("had I entered", "I had entered", "did I enter", "I entered")),
    (G, "Were it not for his help, we ___ in serious trouble.", ("would be", "will be", "are", "had been")),
    (G, "The data, ___ collected, were analysed by an independent team.", ("once", "since", "as though", "unless")),
    (G, "Try ___ he might, he couldn't open the jar.", ("as", "so", "how", "even")),
    (G, "It is imperative that every applicant ___ the form in person.",
     ("submit", "will submit", "has submitted", "would submit")),
    (G, "Much ___ I admire her work, I can't agree with her conclusions.", ("as", "so", "that", "how")),
    (G, "No sooner ___ the announcement than the shares fell.",
     ("had they made", "they had made", "did they make", "they made")),
    (G, "He would sooner resign than ___ to their demands.", ("give in", "giving in", "to give in", "gave in")),
    (G, "Only when the evidence was re-examined ___ the error discovered.", ("was", "had", "did", "it was")),
    (G, "___ he to find out, there would be serious consequences.", ("Were", "Had", "If", "Should be")),
    (V, "His speech was full of ___, saying a great deal while committing to nothing.",
     ("equivocation", "elocution", "edification", "exultation")),
    (V, "Her ___ remarks offended nearly everyone at the table.", ("tactless", "tactful", "tactile", "tactical")),
    (V, "The ruling is ___: there is no further appeal.", ("irrevocable", "irreverent", "irrelevant", "irrational")),
    (V, "The two accounts are ___: both cannot be true.",
     ("irreconcilable", "irreplaceable", "irrepressible", "irredeemable")),
    (V, "He has a ___ for exaggeration.", ("penchant", "pennant", "pendant", "penance")),
    (V, "The scandal ___ public trust in the institution.", ("eroded", "erupted", "evaded", "eluded")),
    (R, "What is the writer's point about the archive?",
     ("Its contents reflect choices about what to keep.", "It is a complete and neutral record.",
      "It was badly damaged.", "It contains mostly unimportant material."),
     "Far from being a neutral record, the archive reflects the priorities of those who compiled it; what was "
     "deemed unworthy of preservation is, by definition, absent."),
    (R, "Why did the apology satisfy few people?",
     ("It seemed reluctant and heavily qualified.", "It came too late.",
      "It was addressed to the wrong people.", "It admitted too much."),
     "The minister's apology, delivered with evident reluctance and hedged with qualifications, satisfied few "
     "of those it was meant to placate."),
    (R, "What is the writer arguing?",
     ("A lack of obvious failure doesn't prove success.", "The policy has clearly failed.",
      "The policy is a clear success.", "Success can't be measured."),
     "To call the policy a success is to mistake the absence of visible failure for evidence of achievement."),
    (R, "What weakens the essay?",
     ("Repeated reliance on unexamined claims.", "One serious factual error.",
      "Its excessive length.", "Too many examples."),
     "The essay's argument is undermined less by any single flaw than by its cumulative reliance on "
     "assertions left unexamined."),
])

BANK: dict[str, list[BankQuestion]] = {"A1": A1, "A2": A2, "B1": B1, "B2": B2, "C1": C1, "C2": C2}
