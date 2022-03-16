import {App} from "@slack/bolt";
import {GenericMessageEvent} from "@slack/bolt/dist/types/events/message-events";
import WebClient from "@slack/web-api/dist/WebClient";
require("dotenv").config();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.APP_TOKEN
});

const submissionsChannel = "wordle";
const answersChannel = "wordle-answers";

app.message(/^(Wordle \d{3} \d\/\d)*/, async ({ client, message, say }) => {
    const event = <GenericMessageEvent><unknown>message

    if (!event) {
        return console.log("Message is not GenericMessageEvent")
    }

    // Needs to be in the right channel
    if (event.channel !== submissionsChannel) {
        return
    }

    const userId = event.user;
    await addUserToChannel(userId, answersChannel, client);

    console.log("Wordle entry recognized");
});

const addUserToChannel = async (userId: string, channel: string, client: WebClient) => {
    await client.channels.invite({ user: userId, channel });
}

(async () => {
    const port = 3000
    await app.start(process.env.PORT || port);
    console.log(`⚡️ Wordle Bot is running on port ${port}!`);
})();
