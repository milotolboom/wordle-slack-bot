import {App, SlashCommand} from "@slack/bolt";
import {GenericMessageEvent} from "@slack/bolt/dist/types/events/message-events";
import WebClient from "@slack/web-api/dist/WebClient";
import {PrismaClient, User} from "@prisma/client";
import {CronJob} from 'cron';

require("dotenv").config();

const prisma = new PrismaClient();

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.APP_TOKEN
});

const cronJob = new CronJob('0 0 * * *', async () => {
    kickAllInPrivateChannel(answersChannelName, app.client)
    console.log("Kicked everyone from #" + answersChannelName + "! Night, night!");
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
            const answersChannel = await getPrivateChannelByName(answersChannelName, client);

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

        switch (result.status) {
            case RegisterUserStatus.NAME_CHANGE:
                const nameChangeResult = result as NameChangeRegisterUserResult
                await say(`\`${nameChangeResult.oldUsername}\` was renamed to \`${nameChangeResult.username}\``)
                return;
            case RegisterUserStatus.NEW_USER:
                await say(`You successfully registered for the wordle battle royale as \`${result.username}\`.`)
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
        await say("Oopsie woopsie, we made a fucky wucky! Pweease twy again later! Fuckywuckycode: 2");
    }
});

app.command('/wordle-stats', async ({command, ack, say}) => {
    try {
        await ack();

        const taggedUserRegex = /<@([a-zA-Z0-9]\w+)\|([a-zA-Z0-9]\w+)>/;
        const userIdMatch = command.text.match(taggedUserRegex);
        var userId = command.user_id;
        var isForOtherUser = false;
        if (userIdMatch) {
            userId = userIdMatch[1];
            isForOtherUser = true;
        }

        const user = await prisma.user.findFirst({
            where: {
                id: userId,
            }
        });

        if (user) {
            const entries = await getUserEntries(userId);
            const returnMessage = composeStatsMessage(user, entries);
            await say(returnMessage);
        } else if (isForOtherUser) {
            await say(`User is not registered to Wordle Battle Royale! Please force them at gunpoint to register using \`/wordle-register yournamehere\``);
        } else {
            await say("You sir are not yet registered to compete within the Wordle leaderboards. Please register using \`/wordle-register yournamehere\`");
        }
    } catch (error) {
        console.error(error);
        await say("Oopsie woopsie, we made a fucky wucky! Pweease twy again later! Fuckywuckycode: 3");
    }
});

const getChannelName = async (channelId: string, client: WebClient) => {
    return (await client.conversations.info({channel: channelId})).channel?.name
}

const getPrivateChannelByName = async (name: string, client: WebClient) => {
    return (await client.conversations.list({types: "private_channel"})).channels?.find(channel => channel.name == name);
}

const addUserToChannel = async (userId: string, channel: string, client: WebClient) => {
    await client.conversations.invite({channel: channel, users: userId});
}

const kickAllInPrivateChannel = async (name: string, client: WebClient) => {
    const channel = await getPrivateChannelByName(name, client);
    const botId = (await client.auth.test()).user_id;
    if (channel) {
        const members = (await client.conversations.members({channel: channel.id!})).members?.filter(id => botId != id);
        if (members) {
            members.forEach(member => {
                client.conversations.kick({channel: channel.id!, user: member})
            });
        }
    }
}

enum RegisterUserStatus {
    NEW_USER, NAME_CHANGE
}

class RegisterUserResult {
    status: RegisterUserStatus;
    username: string;

    constructor(status: RegisterUserStatus, username: string) {
        this.status = status
        this.username = username
    }
}

class NameChangeRegisterUserResult extends RegisterUserResult {
    oldUsername: string;

    constructor(status: RegisterUserStatus, username: string, oldUsername: string) {
        super(status, username);
        this.oldUsername = oldUsername;
    }
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
        await prisma.user.update({
            where: {
                id: user.id,
            },
            data: {
                name: username,
            }
        })
        return new NameChangeRegisterUserResult(
            RegisterUserStatus.NAME_CHANGE,
            username,
            user.name
        );
    }

    await prisma.user.create({
        data: {
            id: userId,
            name: username,
        }
    });

    return new RegisterUserResult(
        RegisterUserStatus.NEW_USER,
        username);
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

    if (score > 6 || score < 0) {
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

const composeStatsMessage = (user: User, entries: Entry[]): string => {
    interface R {
        score: number;
        amount: number;
    }

    const splitByResult = entries.reduce<R[]>((acc, curr) => {
        const score = curr.score;
        const existing = acc.find(it => it.score === score);

        if (!existing) {
            acc.push({score, amount: 1});
            return acc;
        }

        existing.amount++;

        return acc;
    }, []);

    const getAmountForScore = (score): number => splitByResult.find(it => it.score === score)?.amount || 0;
    const totalAmount = entries.length;
    const amountOfBarBlocks = 20;
    const max = splitByResult.sort((a, b) => b.amount - a.amount)[0]?.amount || 1;

    const getBarsForScore = (score): string => {
        const amount = getAmountForScore(score);
        const percentage = amount / max;
        console.log(`max: ${max}`);
        const scaled = Math.round(amountOfBarBlocks * percentage);
        console.log(`scaled: ${scaled}`);
        const rest = Math.max(amountOfBarBlocks - scaled, 0);
        console.log(`rest: ${rest}`);
        return Array.from('█'.repeat(scaled)).join('') + Array.from('▁'.repeat(rest)).join('');
    }

    return `*Stats for <@${user.id}> (a.k.a. ${user.name})*\n
    1️⃣: ${getBarsForScore(1)} (${getAmountForScore(1)})
    2️⃣: ${getBarsForScore(2)} (${getAmountForScore(2)})
    3️⃣: ${getBarsForScore(3)} (${getAmountForScore(3)})
    4️⃣: ${getBarsForScore(4)} (${getAmountForScore(4)})
    5️⃣: ${getBarsForScore(5)} (${getAmountForScore(5)})
    6️⃣: ${getBarsForScore(6)} (${getAmountForScore(6)})
    ❌: ${getBarsForScore(0)} (${getAmountForScore(0)})
    `;
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

type Entry = {
    id: number
    createdAt: Date
    updatedAt: Date
    rawResult: string
    score: number
    userId: string
}

const getUserEntries = async (userId: string): Promise<Entry[]> => {
    const entries = await prisma.entry.findMany({
        where: {userId},
    });

    return entries as Entry[];
};

(async () => {
    const port = 3000
    await app.start(process.env.PORT || port);
    await cronJob.start()
    console.log(`⚡️ Wordle Bot is running on port ${port}!`);
})();
