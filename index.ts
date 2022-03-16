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

const submissionsChannelName = "wordle";
const answersChannelName = "wordle-answers";

app.message(/^(Wordle \d{3} \d\/6).*/, async ({ client, message, say }) => {
    const event = <GenericMessageEvent><unknown>message

    if (!event) {
        return console.log("Message is not GenericMessageEvent")
    }

   const channelName = await getChannelName(event.channel, client);
    // Needs to be in the right channel
    if (channelName !== submissionsChannelName) {
        return console.log("This is not the submissions channel!" + channelName);
    }

    const userId = event.user;
    const answersChannel = await getChannelByName(answersChannelName, client);

    if (answersChannel && answersChannel.id) {
        if (answersChannel.is_archived) {
            console.log("Channel \"#"+answersChannelName+"\" is archived. Unarchiving...")
            await client.conversations.unarchive({channel: answersChannel.id})
        }

        console.log("Adding user to channel \"$"+answersChannel+"\" ")
        await addUserToChannel(userId, answersChannel.id, client);
    } else {
        console.log("Channel \"#"+answersChannelName+"\" does not exist yet. Creating...")
        // Recreate channel
        const channel = (await app.client.conversations.create({name: answersChannelName, is_private: true})).channel

        if (channel && channel.id) {
            console.log("Adding user to channel \"$"+answersChannel+"\" ")
            await addUserToChannel(userId, channel.id, client);
        }
    }
});

const getChannelName = async(channelId: string, client: WebClient) => {
    return (await client.conversations.info({ channel: channelId })).channel?.name
}

const getChannelByName = async(name: string, client: WebClient) => {
    return (await client.conversations.list({types: "public_channel,private_channel"})).channels?.find(channel => channel.name == name);
}

const addUserToChannel = async (userId: string, channel: string, client: WebClient) => {
    await client.conversations.invite({ channel: channel, users: userId });
}

(async () => {
    const port = 3000
    await app.start(process.env.PORT || port);
    console.log(`⚡️ Wordle Bot is running on port ${port}!`);
})();
