import { config } from "dotenv";
import { Client, GatewayIntentBits, Message, TextChannel } from "discord.js";
import { chromium, Page } from "playwright";
import {
  addUserToSheet,
  createGuildSheet,
  deleteUserFromSheet,
  getUsersFromSheet,
} from "./google-sheets.js";

config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Function to log in and redeem for a given user ID with a gift code
async function redeemForUser(
  userId: string,
  username: string,
  giftCode: string
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();

  try {
    // Go to the URL
    await page.goto("https://wos-giftcode.centurygame.com/");

    // Fill the player ID
    await page.fill('input[placeholder="Player ID"]', userId);

    // Click login button
    const loginBtn = page.locator(".login_btn");
    await loginBtn.click();

    try {
      // Ensure login button disappears after login
      await page.waitForSelector(".login_btn", {
        state: "hidden",
        timeout: 5000,
      });
    } catch (error) {
      return `❌ ${username}:${userId} - check UserID, timed out logging in.`;
    }

    // Fill in the gift code
    await page.fill('input[placeholder="Enter Gift Code"]', giftCode);

    // Click the redeem button
    await page.locator(".exchange_btn").click();

    // Get the message
    const message = await page.locator(".msg").textContent();

    await browser.close();
    return `✅ ${username}:${userId} - ${message}`;
  } catch (error) {
    await browser.close();
    console.error(
      `Error redeeming code for user ${username}:${userId} from Google Sheet:`,
      error
    );
    return `❌ ${username}:${userId} - Failed to redeem code ${giftCode}, ${error}`;
  }
}

discordClient.on("messageCreate", async (message: Message) => {
  if (!message.guild || message.author.bot) return; // Ignore bot messages

  const guildId = message.guild.id;

  const args = message.content.split(" ");

  switch (args[0]) {
    case "!redeem":
      if (args.length != 2) {
        return message.reply("⚠️ Usage: `!redeem <giftcode>");
      }

      const giftCode = args[1]; // Extract the gift code
      message.reply(`🔄 Redeeming code **${giftCode}** for all users...`);

      const users = await getUsersFromSheet(guildId);
      if (users.length === 0) {
        return message.reply("❌ No users found in the Google Sheet!");
      }

      for (const user of users) {
        const redeemResult = await redeemForUser(
          user.userId,
          user.username,
          giftCode
        );

        await (message.channel as TextChannel).send(redeemResult);
      }

      message.reply("✅ Finished redeeming codes");
      break;

    case "!add":
      if (args.length != 3) {
        return message.reply(
          "⚠️ Usage: `!add <userId> <username> (no spaces in username)`"
        );
      }

      if (typeof args[1] !== "number") {
        ("⚠️ Usage: `!add <userId> <username> (no spaces in username)`");
      }

      const addResult = await addUserToSheet(guildId, args[1], args[2]);
      message.reply(addResult);
      break;

    case "!delete":
      if (args.length != 2) {
        return message.reply("⚠️ Usage: `!delete <userId>`");
      }

      const deleteResult = await deleteUserFromSheet(guildId, args[1]);
      message.reply(deleteResult);
      break;

    default:
      break;
  }
});

discordClient.once("ready", async () => {
  console.log(`Logged in as ${discordClient.user?.tag}!`);

  for (const guild of discordClient.guilds.cache.values()) {
    await createGuildSheet(guild.id, guild.name);
  }
});

/**
 * When the bot joins a new server, create a new Google Sheet tab for it.
 */
discordClient.on("guildCreate", async (guild) => {
  console.log(`📌 Joined new server: ${guild.name} (${guild.id})`);
  await createGuildSheet(guild.id, guild.name);
});

discordClient.login(DISCORD_BOT_TOKEN);
