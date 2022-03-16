import {App} from "@slack/bolt";
import {GenericMessageEvent} from "@slack/bolt/dist/types/events/message-events";
require("dotenv").config();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.APP_TOKEN
});

app.message(/^(Wordle \d{3} \d\/\d)*/, async ({ message, say }) => {
    const event = <GenericMessageEvent><unknown>message

    if (!event) {
        return console.log("Message is not GenericMessageEvent")
    }

    // Needs to be in the right channel
    if (event.channel !== "wordle-submissions") {
        return
    }

    const userId = event.user;
    console.log('Wordle entry recognized');
});

(async () => {
    const port = 3000
    await app.start(process.env.PORT || port);
    console.log(`⚡️ Wordle Bot is running on port ${port}!`);
})();
