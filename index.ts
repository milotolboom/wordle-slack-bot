import {App, SlashCommand} from "@slack/bolt";
import {GenericMessageEvent} from "@slack/bolt/dist/types/events/message-events";
import WebClient from "@slack/web-api/dist/WebClient";
import {PrismaClient} from "@prisma/client";
import { CronJob } from 'cron';

require("dotenv").config();

const prisma = new PrismaClient();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.APP_TOKEN
});

const cronJob = new CronJob('0 0 * * *', async () => {
    kickAllInChannel(answersChannelName, app.client)
    console.log("Kicked everyone from #"+answersChannelName+"! Night, night!");  
});

const submissionsChannelName = "wordle";
const answersChannelName = "wordle-answers";

app.message(/^(Wordle \d{1,4} (\d|X)\/6).*/, async ({client, message, say}) => {
    const event = <GenericMessageEvent><unknown>message

    if (!event) {
        return console.log("Message is not GenericMessageEvent")
    }

    const channelName = await getChannelName(event.channel, client);
    // Needs to be in the right channel
    if (channelName !== submissionsChannelName) {
        return console.log("This is not the submissions channel!" + channelName);
    }

    const result = await registerEntry(event);

    switch (result) {
        case RegisterEntryResult.SUCCESS:
            await say("Your Wordle entry was successfully submitted! 🎉")
            const userId = event.user;
            const answersChannel = await getChannelByName(answersChannelName, client);

            if (answersChannel && answersChannel.id) {
                if (answersChannel.is_archived) {
                    console.log("Channel \"#" + answersChannelName + "\" is archived. Unarchiving...")
                    await client.conversations.unarchive({channel: answersChannel.id})
                }

                console.log("Adding user to channel \"$" + answersChannel + "\" ")
                await addUserToChannel(userId, answersChannel.id, client);
            } else {
                console.log("Channel \"#" + answersChannelName + "\" does not exist yet. Creating...")
                // Recreate channel
                const channel = (await app.client.conversations.create({
                    name: answersChannelName,
                    is_private: true
                })).channel

                if (channel && channel.id) {
                    console.log("Adding user to channel \"$" + answersChannel + "\" ")
                    await addUserToChannel(userId, channel.id, client);
                }
            }

            return;
        case RegisterEntryResult.USER_NOT_REGISTERED:
            await say("You sir are not yet registered to compete within the Wordle leaderboards. Please register using \`/wordle-register yournamehere\`");
            return;
        case RegisterEntryResult.ALREADY_ENTERED_TODAY:
            await say("You already registered an entry today. You can post your new results tomorrow.");
            return;
        case RegisterEntryResult.INVALID_SCORE:
            await say("Ey niffo your score is not 1, 2, 3, 4, 5 or X. Stop trying to cheat the system.");
            return;
    }
});

app.command('/wordle-register', async ({command, ack, say}) => {
    try {
        await ack();
        const result = await registerUser(command);

        switch (result) {
            case RegisterUserResult.ALREADY_EXISTS:
                await say("You already registered.")
                return;
            case RegisterUserResult.SUCCESS:
                await say("You successfully registered for the wordle battle royale.")
                return;
        }
    } catch (error) {
        console.error(error);
        await say("Oopsie woopsie, we made a fucky wucky! Pweease twy again later! Fuckywuckycode: 1");
    }
});

app.command('/wordle-leaderboard', async ({command, ack, say}) => {
    try {
        await ack();

        const stats = await getUserStats();
        const topTen = stats.slice(0, 10);
        const returnMessage = composeLeaderboardMessage(topTen);

        await say(returnMessage);
    } catch (error) {
        console.error(error);
        await say("Oopsie woopsie, we made a fucky wucky! Pweease twy again later! Fuckywuckycode: 2")
    }
});

const getChannelName = async (channelId: string, client: WebClient) => {
    return (await client.conversations.info({channel: channelId})).channel?.name
}

const getChannelByName = async (name: string, client: WebClient) => {
    return (await client.conversations.list({types: "public_channel,private_channel"})).channels?.find(channel => channel.name == name);
}

const addUserToChannel = async (userId: string, channel: string, client: WebClient) => {
    await client.conversations.invite({channel: channel, users: userId});
}

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

enum RegisterUserResult {
    SUCCESS, ALREADY_EXISTS
}

const registerUser = async (command: SlashCommand): Promise<RegisterUserResult> => {
    const userId = command.user_id;
    const username = command.text;

    const user = await prisma.user.findFirst({
        where: {
            id: userId,
        }
    });

    if (user) {
        return RegisterUserResult.ALREADY_EXISTS;
    }

    await prisma.user.create({
        data: {
            id: userId,
            name: username,
        }
    });

    return RegisterUserResult.SUCCESS;
};

enum RegisterEntryResult {
    SUCCESS, USER_NOT_REGISTERED, ALREADY_ENTERED_TODAY, INVALID_SCORE
}

const isSameDate = (a: Date, b: Date): boolean => {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
}

const registerEntry = async (event: GenericMessageEvent): Promise<RegisterEntryResult> => {
    const message = event.text;
    const userId = event.user;

    const user = await prisma.user.findFirst({
        where: {
            id: userId,
        }
    });

    if (!user) {
        return RegisterEntryResult.USER_NOT_REGISTERED;
    }

    const latestEntry = await prisma.entry.findFirst({
        where: {
            userId,
        },
        orderBy: {
            createdAt: "desc"
        }
    });

    if (latestEntry) {
        const latestEntryDate = new Date(latestEntry.createdAt);
        const currentDate = new Date();

        if (isSameDate(latestEntryDate, currentDate)) {
            return RegisterEntryResult.ALREADY_ENTERED_TODAY;
        }
    }

    const rawScore = message?.match(/(\d|X)\/6/) || [];
    const guesses = rawScore[0][0];
    const score: number = guesses === "X" ? 0 : +guesses;

    if (score > 6 || score < 1) {
        return RegisterEntryResult.INVALID_SCORE;
    }

    await prisma.entry.create({
        data: {
            userId,
            rawResult: message || "",
            score,
        }
    })

    return RegisterEntryResult.SUCCESS;
};

const composeLeaderboardMessage = (stats: UserStat[]): string => {
    const userStats = stats.map((stat, index) =>
        `${index + 1}. _${stat.name}_ | Average solve score \`${stat.averageSolvedAt}\` | Played \`${stat.played}\` | Lost \`${stat.played - stat.wins}\``);

    return `🧠 *Wordle Leaderboard* 🧠\n\n${userStats.join('\n')}`
}

interface UserStat {
    name: string;
    played: number;
    wins: number;
    averageSolvedAt: number;
}

const getUserStats = async (): Promise<UserStat[]> => {
    const allEntries = await prisma.entry.findMany({
        include: {user: true}
    });

    const getUserName = (userId: string): string => {
        return allEntries.find((it) => it.userId === userId)?.user.name ?? userId;
    }

    const allUsers = [...new Set(allEntries.map((it) => it.userId))];

    const stats: UserStat[] = allUsers.map((userId) => {
        const entries = allEntries.filter((entry) => entry.userId === userId);
        const wins = entries.filter((entry) => entry.score > 0).length;

        const averageSolvedAt = entries.map((entry) => entry.score).reduce((acc, curr) => {
            console.log(curr, curr * 100);
            // Failures to guess (0) should be counted as 2 penalty points (6 + 2
            const normalizedScore = (curr === 0 ? 8 : curr) * 100;
            // We multiply by 100 to make score more arbitrary
            return acc + normalizedScore;
        }, 0) / entries.length;

        return ({
            name: getUserName(userId),
            played: entries.length,
            wins,
            averageSolvedAt: Math.round(averageSolvedAt),
        })
    });

    return stats.sort((a, b) => a.averageSolvedAt - b.averageSolvedAt);
};

(async () => {
    const port = 3000
    await app.start(process.env.PORT || port);
    await cronJob.start()
    console.log(`⚡️ Wordle Bot is running on port ${port}!`);
})();
