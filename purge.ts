import {App} from "@slack/bolt";
import WebClient from "@slack/web-api/dist/WebClient";
require("dotenv").config();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.APP_TOKEN
});

const kickAllInChannel = async(name: string, client: WebClient) => {
    const channel = await getChannelByName(name, client);
    const botId = (await client.auth.test()).user_id;
    if (channel) {
        const members = (await client.conversations.members({ channel: channel.id! })).members?.filter ( id => botId != id );
        if (members) {
            members.forEach ( member => {
                client.conversations.kick({channel: channel.id!, user: member})
            });
        }
    }
}

const getChannelByName = async(name: string, client: WebClient) => {
    return (await client.conversations.list({types: "public_channel,private_channel"})).channels?.find(channel => channel.name == name);
}

const answersChannelName = "wordle-answers";

(async () => {
    kickAllInChannel(answersChannelName, app.client)
})();
