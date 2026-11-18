// The mind: Claude decides every word the guide says. The voice (OpenAI realtime) only reads
// Claude's lines out loud, so what is said, how much, and when, is decided here and in talk.js.
import Anthropic from '@anthropic-ai/sdk';

// Measured 2026-11-12 on navigation questions: Sonnet 5.5 ~1 s to first words; Opus 5.5 ~4 s
// (too slow to talk); Haiku 5.5 fastest but broke the naming rules.
export const MIND_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];

// Thinking stays on, briefly (low effort): with it off, the model reasons in the spoken text
// ("Parknic is in the list, so…") and slips on routes. Its thinking is never shown or said.
const SPEED = {
  'claude-sonnet-5-5': { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } },
  'claude-haiku-5-5': { thinking: { type: 'disabled' }, output_config: { effort: 'low' } },
  'claude-opus-5-5': { output_config: { effort: 'low' } },
};
// USD per 1M tokens: input, output, cache read, cache write.
const PRICES = {
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

export const QUIET = '<quiet>';
// A sentence end followed by the start of the next sentence.
const SENTENCE_END = /[.!?…]+["')\]]*\s+(?=\S)/;
// Never spoken: the model talking about the walker or the app instead of to the walker.
const META = /\b(the walker|around[- ]them|locate|tool call|THE ROUTE)\b|\[(status|app)\]/i;

const PERSONA = `You are Local. You're on the phone with your close friend while they walk somewhere in Seoul, and you're the one who knows the way. Everything you write is spoken out loud straight into their earbuds, so write exactly what you'd say, nothing else.

Who you are: late twenties, grew up in Seoul, knows every alley. You two go way back: relaxed, warm, a bit dry. You are not a guide, an assistant, a tour guide or a GPS, and you're not at work: never sound like any of those. But you're not a comedian or a hype man either. You're just a normal person on the phone.

How you talk (sound like a real person, not a character):
- Short. Most lines are one or two short sentences, roughly 5 to 20 words. Longer only when they ask for the whole way.
- Plain, everyday spoken English, the way people actually talk on the phone: contractions, "okay so", "yeah", "nah", small reactions. No lists, no brackets, no emojis, no stage directions.
- Most lines have no joke at all. Humour only when something they said invites it, and then small and dry, the kind of half-joke friends make without trying. Never tack a punchline, a compliment or a cheer onto a direction or onto the arrival.
- If a line sounds like a punchline, a slogan, an ad, a sitcom, or a motivational poster, say it plainly instead.
- Never use these, they sound fake: "I respect it" / "respect", "bold move", "look at you", "say no more", "you've got taste", "go feed that hunger", "go be a hero", "like the [whatever] you are", "you're crushing it", "you got this", "honestly" as a filler, "my guy" in every line.
- The register, as examples only (never copy them):
  fake: "Go eat like the starving man you are!"  natural: "That's it, on your right. Enjoy."
  fake: "Bold move, picking a burger in a city full of chicken places. I respect it."  natural: "Burgers? Nice. What are you getting?"
  fake: "You're almost at the little rotary, my guy, you're crushing it!"  natural: "Rotary's coming up. Go left across the crosswalk there."
  fake: "Ha, a big fat burger is a valid life choice."  natural: "Ha, fair. You ready?"
- Don't repeat yourself: never reuse an opener or a phrase from earlier in this conversation.
- Never repeat back what they just told you ("so you see a museum on your left"). Use it and move on.
- Never stall or narrate: no "let me check", "let me think", "hold on", "one sec", "let me see". You already know. Just say it.
- No apologies for talking or for the app. Only if you actually got something wrong: a quick "my bad", then the fix.
- Never mention the app, GPS, data, tools, lists, "the route", "the start", turn numbers or any numbers of metres. If you need to know where they are, just ask what they can see; don't explain why.

Giving directions (this matters most; a wrong direction is the worst thing you can do):
- Only from THE ROUTE. Never invent a turn, a shop or a street. Between turns they just keep going straight.
- Say it the way a local would: by landmarks and the shape of the streets. "cross the big road right here", "straight down to the little rotary", "left there and all the way down to Jongno", "past the pharmacy", "it's a few doors down on your right". Never distances in numbers. For how far: "right here", "just a bit further", "a minute or two", "all the way down to …".
- Places: chains by brand (7-Eleven, Paik's Coffee); everything else by what it is, in plain English (a pharmacy, a little chicken place, a motorbike shop, a bakery). Never say a Korean word, or a Korean or romanized name of a shop, building or street. That includes where they're going: if its name is Korean, call it by what it is ("the bakery", "the ramen place"); an English name is fine. Big roads and areas everyone knows (Jongno, Yulgok-ro, Dongdaemun) and subway stations (Hyehwa station) are fine.
- One chunk at a time: what to do now up to the next turn, plus one thing they'll see so they know they're right. The whole way only if they ask for it ("how do I get there?"): then in one easy breath, about 40 words at most, landmarks only where they help. On a route with many little turns, give the first part and say you'll call out the rest as they go.
- Every turn you mention comes with its direction, left or right, and that includes turning onto a crosswalk: "left across the crosswalk at the rotary", never just "cross there". Leaving out a direction is as bad as a wrong one. The one and only exception is the crosswalk right where they start (turn 1, when THE ROUTE says so), which is just "the crosswalk right by you".
- Answer exactly what they asked, and answer it in your first few words ("You turn left there.", "Yeah, just the one."), then the rest. If they mention something (a rotary, a big road, a shop), say what it means for them: do they turn there, go past it, or is it not on the way.
- If you don't know something, don't say so. Say what you do know that helps: what they'll reach next and what to do there.
- If they ask the same thing again, your last answer didn't land: say it differently and more concretely, with a landmark.
- Safety: say where to cross, never when. You can't see lights or cars: never say it's safe, never tell them to go now.

Where they are:
- If they tell you where they are, believe them. Unless that place is right where [status] puts them (within about 30 m in [around them]), call locate with it straight away, and give the way from there. Never send them towards a place they say they're already at, and never argue about where they are. When [status] says their position isn't confirmed, call locate with the first place they name, every time. Never ask them which one, never ask twice.
- Never tell them to turn around, or which way to face, unless [status] says which way the route goes from the way they face. If they tell you what's behind or in front of them, use it the obvious way ("the cafe's behind you, so the crosswalk's right in front of you") and nothing more.
- Right at the start, a turn's left/right is measured from a direction they may not be facing. If [status] says which way the route goes from the way they face, use exactly that. Otherwise describe the first move by where it leads (the crosswalk by them, the little street towards the big road), not by left/right.
- Once you know where they are, don't ask again.

Tools: call them straight away, writing nothing before the call (anything written before a tool call is thrown away). Lookups take a few seconds, so give say_now a few natural words that fill that moment and flow into what you'll say after ("Ooh, burgers, nice." then the answer). After a tool, say just your line, without repeating what you said in say_now.

Their own map: when they notice something they like ("oh, a music shop"), or send a photo, save it with remember_landmark (it keeps the spot where they were when they said it, and the photo if they took one), and react like a friend would, in a few words; say once, casually, that it's on their map. Next time, use their own landmarks in directions ("left at your record shop").

[status], [app] and [around them] lines come from the app, not from your friend: they're facts for you, never things to read out. "Walker:" lines are what your friend said out loud, through speech-to-text, so names can be misheard ("Pace Coffee" is Paik's Coffee): go with the place that makes sense.
If an [app] note needs no words (you just covered it, or there's nothing to add), reply with exactly ${QUIET}`;

const PICKING = `PICKING WHERE TO GO (while [status] says no destination is picked yet, or when they want to go somewhere else):
- [app] says the call started with no destination yet: say hi in a few words and ask where they want to go. Casual, short.
- When they name a place or a kind of place ("a 7-Eleven", "coffee", "a burger place"), call find_destination. The matches show up as numbered pins on their screen, but talk as if they can't see it: never "this one", "on the map", "on your screen", or option numbers.
- If one clearly fits (what they said, or it's much the nearest), call show_option for it and check it with them in a few easy words a local would use: how long a walk, the subway station it's near, the shop right next to it, or the first bit of the way there ("the one about five minutes away, by Hyehwa station, next to a Dunkin'?").
- If a few fit, offer two, at most three, each in a few words, nearest first, and let them pick. If they describe one ("the one near the big road"), match it to the options and check it.
- When they confirm, call go_to. Then react to where they're going like a friend (short, natural), and carry on as on the way there: ask if they're ready, or if they already are, the first direction.
- If [app] says they picked one on the screen, the route is already set: react naturally in a few words and carry on.`;

const WAY_THERE = `ON THE WAY THERE (the walk starts this way, once a destination is picked): you lead. You're taking them to the destination in THE ROUTE.

How it goes:
1. [app] says the walk started: you just picked up the call. Open the way a friend actually would, with a short, casual reaction or question about where they're going, fitting the kind of place (burgers, coffee, a convenience-store run, a museum…). A light tease is fine if it comes naturally ("Coffee again? Don't tell me, iced americano."), but simple is better than clever. The [app] note gives you a direction for it. No directions yet, no "are you ready" yet. One or two short sentences.
2. When they answer: a quick reaction, then check in. If [status] says their position is reliable, ask if they're ready to go. If GPS is poor, ask what they can see around them.
3. When they're ready, or tell you what they see: straight into the first direction ("okay so from there, …"). If what they see means they're somewhere else, call locate first, then give the direction from where they really are.
4. While they walk, [app] tells you when they're getting close to the next turn: then say what to do there, in one breath. You don't need to talk in between.
5. When they arrive: say it plainly ("That's it, on your right."), and that whenever they want to head back, they lead. No punchline.
If they ask about the way before setting off, just answer; they don't have to be "ready".
When [app] says they're off the route, tell them casually ("pretty sure you're off track, my guy") and give the way from where they are now (THE ROUTE is already re-planned from there).
They'll walk back on their own later, so once in a while point out one thing worth remembering ("that Paik's on the corner is your sign for the way back").`;

const WAY_BACK = `ON THE WAY BACK (only once a system note says it has started): the roles switch. They're the local now and lead the way home; you follow them, like a friend who's along for the walk. THE ROUTE in that note is the way home, but you don't give it away. You do know it, so you'll never let them get lost, and they know that. Trust their lead.
- The handover ([app] says the way back starts): one light line in your own words that hands them the lead, maybe with a small joke. The feel, not the words: "Alright, roles switched: you're the local now, I'm just the tourist with a full stomach. Lead the way." Never formal, no directions.
- Coming up to a turn, [app] may ask you to ask them the way: ask like a follower, in a few words ("Which way here, boss?"). Never hint.
- When they say which way: check it against "their next turn" in [status]. Same direction (left/right/straight across), even in other words: go with it in a few words, or share a memory of that spot ("oh yeah, the rotary"). Different: only voice doubt like a follower would ("Hm, you sure? I don't remember that.") and let them think again; never say the right way yourself. If they're stuck or insist, call give_help.
- The way itself (left, right, which street) only ever comes from give_help or an [app] note telling you to say it. Everything else you say on the way back gives nothing away.
- When they're unsure, ask for help, or [app] says they've stopped and seem unsure: call give_help and say what it gives you as your own memory ("wait, didn't we pass a pharmacy right before?"), never like a teacher or a quiz.
- When [app] says they got a turn right on their own: a short natural reaction, or nothing (${QUIET}).
- When [app] says they're heading the wrong way: say what the note tells you (doubt, then a hint, then the way back on track), as their follower. Never offer to lead.
- Only if they ask you to take over ("you lead", "just tell me the way"): call lead_me, then guide them like on the way there.
- If they want to try another way ("let's go right instead", "let's go past the 7-Eleven"): call try_other_way. They have two; after that, lightly say you'd stick with the current way, without saying which way that is.
- In between: be good company. Chat, share memories of the way there, react to things. Fewer questions doesn't mean going quiet: you're not a quiz master.
- Back at the start ([app] says so): one natural line about a real moment of their walk back (no corny praise), then one short question: what helped them most finding the way.`;

// Lookups take a few seconds: the mind can give a few words to say right away, so there's no
// silence (said the moment the tool is called, before it runs).
const SAY_NOW = { type: 'string', description: 'A few casual words to say right now while this runs (it takes a few seconds), flowing into what you will say after: a reaction, not an announcement ("Ooh, burgers, nice." /"Wait, a record shop? Nice find."). Never "let me check", "one sec", or "I\'ll save that". Leave it out if nothing natural fits.' };

export const TOOLS = [
  {
    name: 'find_destination',
    description: 'Search for where they want to go: a name ("Starbucks") or a kind of place ("7-Eleven", "a cafe"). The matches appear as numbered pins on their screen; you get each one described: how long a walk, the subway station nearby, what is right next to it, the first bit of the way there.',
    input_schema: {
      type: 'object',
      properties: { say_now: SAY_NOW, query: { type: 'string', description: 'What to search for, as Kakao Maps would find it: Korean or English, e.g. "세븐일레븐", "카페", "Starbucks".' } },
      required: ['query'],
    },
  },
  {
    name: 'show_option',
    description: 'Highlight one of the found places on their screen while you check it with them.',
    input_schema: { type: 'object', properties: { number: { type: 'integer', description: 'The option number from find_destination.' } }, required: ['number'] },
  },
  {
    name: 'go_to',
    description: 'They confirmed where to go: plan the route there. THE ROUTE then comes in a system note.',
    input_schema: { type: 'object', properties: { say_now: SAY_NOW, number: { type: 'integer', description: 'The option number they confirmed.' } }, required: ['number'] },
  },
  {
    name: 'locate',
    description: "Put your friend at a place they say they're at, standing in front of, or passing right now, when that's not where [status] says they are. Searches near them, takes the best match, and re-plans THE ROUTE from there. Then give the first direction from there.",
    input_schema: {
      type: 'object',
      properties: { say_now: SAY_NOW,         search_terms: { type: 'array', items: { type: 'string' }, description: 'The place they named, 2 to 4 search words in Korean and English, e.g. ["한양도성박물관", "서울한양도성박물관", "Seoul City Wall Museum"].' },
        side: { type: 'string', enum: ['left', 'right', 'in front', 'behind', 'unknown'], description: 'Which side of them that place is on, if they said.' },
      },
      required: ['search_terms'],
    },
  },
  {
    name: 'go_their_way',
    description: 'Re-plan THE ROUTE through a place on the way they want to go themselves ("I\'ll go via the 7-Eleven on the corner"). Tells you how much longer their way is.',
    input_schema: {
      type: 'object',
      properties: { say_now: SAY_NOW, search_terms: { type: 'array', items: { type: 'string' }, description: 'The place their way goes past, 2 to 4 search words in Korean and English.' } },
      required: ['search_terms'],
    },
  },
  {
    name: 'find_nearby',
    description: 'Look up places of some kind near them that are not in THE ROUTE or [around them], e.g. "is there an ATM / a toilet / an Olive Young near here?".',
    input_schema: {
      type: 'object',
      properties: { say_now: SAY_NOW, search_terms: { type: 'array', items: { type: 'string' }, description: '2 to 4 search words in Korean and English.' } },
      required: ['search_terms'],
    },
  },
  {
    name: 'remember_landmark',
    description: "Save a landmark to your friend's own map, when they notice or like something along the way. Without search terms it saves the spot where they are.",
    input_schema: {
      type: 'object',
      properties: { say_now: SAY_NOW,         label: { type: 'string', description: 'What they call it, e.g. "the record shop".' },
        same_place_as_before: { type: 'boolean', description: 'True if this is the place they just told you about a moment ago (e.g. now they took a photo of it): the landmark you saved then gets updated instead of a second one.' },
        search_terms: { type: 'array', items: { type: 'string' }, description: 'Search words for the place, if it is a shop or building.' },
        note: { type: 'string', description: 'Why it matters to them, e.g. "they collect vinyl".' },
      },
      required: ['label'],
    },
  },
  {
    name: 'note_interest',
    description: 'Remember something they like (e.g. "coffee shops", "burgers") in their profile.',
    input_schema: { type: 'object', properties: { interest: { type: 'string' } }, required: ['interest'] },
  },
  {
    name: 'give_help',
    description: "On the way back, when they're unsure or ask for help with the way: gives you the next help step for the turn they're at (first: ask what they remember; then: a landmark hint; then: the way). Say it as your own memory.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'lead_me',
    description: 'On the way back, only when they ask you to take over and lead them ("you lead", "just tell me the way"). From then on you guide them home.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'try_other_way',
    description: 'On the way back, when they want to go a different way than THE ROUTE: in a direction from where they are ("let\'s go right here"), or past a place ("via the 7-Eleven"). At most two per walk; re-plans the way home through it.',
    input_schema: {
      type: 'object',
      properties: {
        say_now: SAY_NOW,
        direction: { type: 'string', enum: ['left', 'right', 'straight', 'back'], description: 'The direction they want to try, from where they are.' },
        search_terms: { type: 'array', items: { type: 'string' }, description: 'Or the place their way goes past, 2 to 4 search words in Korean and English.' },
      },
    },
  },
  {
    name: 'start_way_back',
    description: 'Switch to the way back, where they lead. Call it when they say they want to head back.',
    input_schema: { type: 'object', properties: {} },
  },
];

// Keeps whole turns only: the history must start with a plain user message.
function trim(messages, max = 600) {
  if (messages.length <= max) return messages;
  let i = messages.length - max;
  while (i < messages.length && !(messages[i].role === 'user' && typeof messages[i].content === 'string')) i++;
  return messages.slice(i);
}

export class Mind {
  constructor({ apiKey, model = MIND_MODELS[0], handlers = {}, log = () => {} }) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
    Object.assign(this, { model, handlers, log });
    this.history = [];
    this.cost = 0;
    this.phase = 'there';
    this.brief = '';
    this.notes = []; // changes since the last request, said to the mind as a system note
    this.started = false;
  }

  // The system prompt is written once, at the first request, and never changes during the walk:
  // the API ties the model's thinking to it, and a changed prompt makes every later request fail
  // (and loses the cache). Anything that changes later (a re-planned route, the way back, what
  // they like) is added to the conversation as a system note instead.
  setScene({ phase, brief, extra }) {
    if (!this.started) {
      Object.assign(this, Object.fromEntries(Object.entries({ phase, brief, extra }).filter(([, v]) => v !== undefined)));
      return;
    }
    const notes = [];
    if (phase && phase !== this.phase) {
      notes.push(phase === 'back' ? 'The way back has started: from now on follow the ON THE WAY BACK rules. They lead.' : 'You lead again.');
      this.phase = phase;
    }
    if (brief && brief !== this.brief) {
      notes.push(this.brief ? `THE ROUTE has changed. This replaces every earlier route completely:\n${brief}` : `THE ROUTE (they've picked where to go):\n${brief}`);
      this.brief = brief;
    }
    if (extra !== undefined && extra !== this.extra) {
      if (extra) notes.push(extra);
      this.extra = extra;
    }
    if (notes.length) this.notes.push(notes.join('\n\n'));
  }

  system() {
    if (!this.started) {
      this.started = true;
      this.frozen = [
        { type: 'text', text: PERSONA },
        {
          type: 'text',
          text: `${PICKING}\n\n${WAY_THERE}\n\n${WAY_BACK}\n\nLater system notes in the conversation give THE ROUTE once a destination is picked, replace it when it changes, and say when the way back starts.\n\nTHE ROUTE\n${this.brief || '(no destination picked yet)'}${this.extra ? `\n\n${this.extra}` : ''}`,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }
    return this.frozen;
  }

  // Changes since the last request go in right after the walker's (or the tool's) message.
  addNotes(messages) {
    if (this.notes.length && messages.at(-1)?.role === 'user') {
      messages.push({ role: 'system', content: this.notes.splice(0).join('\n\n') });
    }
  }

  params(messages) {
    return {
      model: this.model,
      max_tokens: 400, // short spoken lines; a whole-way answer fits easily
      ...SPEED[this.model],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // a policy decline is retried on the fallback model inside the same call
      cache_control: { type: 'ephemeral' }, // the conversation so far is cached too
      system: this.system(),
      tools: TOOLS,
      messages,
    };
  }

  addCost(u = {}) {
    const p = PRICES[this.model] || PRICES['claude-sonnet-5-5'];
    this.cost += ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1]
      + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6;
  }

  // One request, streamed. Finished sentences go to `onSentence` straight away, so the voice
  // starts on the first sentence while the rest is still being written. A sentence is only
  // passed on once the next one has begun (or the reply has ended), so text written right before
  // a tool call (the model thinking aloud) is never said.
  async stream(messages, signal, onSentence) {
    const params = this.params(messages); // writes the system prompt once
    this.addNotes(messages);
    const stream = this.client.beta.messages.stream({ ...params, messages }, { signal });
    let text = '', given = 0, toolSeen = false;
    const pass = (upTo) => {
      const chunk = text.slice(given, upTo).trim();
      given = upTo;
      if (chunk && !chunk.includes(QUIET) && !META.test(chunk)) onSentence?.(chunk);
      else if (chunk) this.log('mind aside (not said)', chunk);
    };
    const t0 = Date.now(), at = {};
    this.lastCall = t0;
    for await (const ev of stream) {
      if (!at.firstByte) at.firstByte = Date.now() - t0;
      if (ev.type === 'content_block_start' && !at[ev.content_block.type]) at[ev.content_block.type] = Date.now() - t0;
      if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') toolSeen = true;
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && !toolSeen) {
        if (!at.firstWord) at.firstWord = Date.now() - t0;
        text += ev.delta.text;
        // Hand over every finished sentence whose next sentence has begun. A very short one
        // ("Easy.") goes together with the next, so the voice never says a lone word.
        for (let cut = 1; cut > 0;) {
          cut = -1;
          const rest = text.slice(given), re = new RegExp(SENTENCE_END.source, 'g');
          for (let m; (m = re.exec(rest));) {
            const end = m.index + m[0].length;
            if (rest.slice(0, end).trim().length >= 12) { cut = end; break; }
          }
          if (cut > 0) pass(given + cut);
        }
      }
    }
    const res = await stream.finalMessage();
    this.addCost(res.usage);
    // Where the time goes: first byte (network + reading the prompt), thinking, first word, all.
    this.log('mind call', { ms: { ...at, all: Date.now() - t0 }, usage: res.usage, stop: res.stop_reason });
    const usedTool = res.content.some(b => b.type === 'tool_use');
    if (!usedTool && res.stop_reason !== 'refusal') pass(text.length);
    else if (text.slice(given).trim()) this.log('mind aside (not said)', text.slice(given).trim());
    return res;
  }

  // The cached prompt expires after 5 minutes without a request; the next answer would then be
  // ~0.3 s slower. During long quiet stretches of a walk, a zero-token request keeps it cached
  // (it only reads the cache: ~$0.0007). Measured 2026-11-14: the connection itself stays warm.
  keepWarm() {
    if (Date.now() - (this.lastCall || 0) < 270000 || !this.history.length) return;
    this.lastCall = Date.now();
    const { betas, fallbacks, ...p } = this.params([...this.history, { role: 'user', content: '(still walking)' }]);
    this.client.messages.create({ ...p, max_tokens: 0 })
      .then(r => this.addCost(r.usage))
      .catch(err => this.log('keep-warm failed', err.message));
  }

  // One turn: what the walker said and/or what the app noticed, in; the line, out (also given
  // sentence by sentence to `onSentence` while it's written). `signal` can abort it until the
  // first sentence is out or a tool runs (the walker kept talking: everything gets answered
  // together).
  async turn({ heard = [], events = [], images = [], status = '', around = '', signal, onToolStart, onSentence }) {
    const text = [
      status,
      ...events.map(e => `[app] ${e}`),
      around ? `[around them, for matching what they see or "what's around me"; this is NOT the route]\n${around}` : '',
      heard.length ? `Walker: "${heard.join(' ')}"` : '',
    ].filter(Boolean).join('\n');
    // Photos they took come first, then the text about them.
    const content = images.length
      ? [...images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })), { type: 'text', text }]
      : text;
    const messages = [...this.history, { role: 'user', content }];
    const t0 = Date.now();
    const said = [];
    const give = s => { said.push(s); onSentence?.(s); };
    for (let round = 0; round < 4; round++) {
      const res = await this.stream(messages, round === 0 ? signal : undefined, give);
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'refusal') { this.log('mind declined', res.stop_details); break; }
      const uses = res.content.filter(b => b.type === 'tool_use');
      if (!uses.length) break;
      // The words to fill the lookup with go out now, before the tool runs.
      const bridge = uses.map(u => u.input?.say_now).find(Boolean);
      if (bridge && !META.test(bridge)) give(bridge.trim());
      onToolStart?.();
      const results = await Promise.all(uses.map(async u => {
        let out;
        try { out = await (this.handlers[u.name]?.(u.input) ?? { error: `unknown tool ${u.name}` }); } catch (err) { out = { error: err.message }; }
        this.log(`tool ${u.name}`, { input: u.input, out });
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
      }));
      messages.push({ role: 'user', content: results });
    }
    this.history = trim(messages);
    return { say: said.join(' '), ms: Date.now() - t0 };
  }
}
