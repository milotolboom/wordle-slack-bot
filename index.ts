import {App} from "@slack/bolt";
import {GenericMessageEvent} from "@slack/bolt/dist/types/events/message-events";
import WebClient from "@slack/web-api/dist/WebClient";
import { PrismaClient } from "@prisma/client";
require("dotenv").config();

const prisma = new PrismaClient();

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

app.command('/leaderboard', async ({ command, ack, say }) => {
    try {
        await ack();

        const stats = await getUserStats();
        const topTen = stats.slice(0, 10);
        const returnMessage = composeLeaderboardMessage(topTen);

        await say(returnMessage);
    } catch (error) {
        console.error(error);
        await say("Oopsie woopsie, we made a fucky wucky! Pweease twy again later!")
    }
});

const composeLeaderboardMessage = (stats: UserStat[]): string => {
    const userStats = stats.map((stat) => `
        • ${stat.name} | Average solve score ${stat.averageSolvedAt} | Played ${stat.played} | Wins ${stat.wins} 
    `);

    return `
    **🧠 Wordle Leaderboard 🧠**\n\n
    ${userStats.join('\n')}
    `
}

interface UserStat {
    name: string;
    played: number;
    wins: number;
    averageSolvedAt: number;
}

const getUserStats = async (): Promise<UserStat[]> => {
    const allEntries = await prisma.entry.findMany({
        include: { user: true }
    });

    const allUsers = [...new Set(allEntries.map((it) => it.userId))];

    return allUsers.map((userId) => {
        const entries = allEntries.filter((entry) => entry.userId === userId);
        const wins = entries.filter((entry) => entry.score > 0).length;
        const averageSolvedAt = entries.map((entry) => entry.score).reduce((acc, curr) => {
            // Failures to guess (0) should be counted as 2 penalty points (6 + 2)
            const normalizedScore = curr === 0 ? 8 : curr;
            return acc + normalizedScore;
        });

        return ({
            name: userId, // TODO create register option
            played: entries.length,
            wins,
            averageSolvedAt,
        })
    });
};

const addUserToChannel = async (userId: string, channel: string, client: WebClient) => {
    await client.channels.invite({ user: userId, channel });
}

(async () => {
    const port = 3000
    await app.start(process.env.PORT || port);
    console.log(`⚡️ Wordle Bot is running on port ${port}!`);
})();
