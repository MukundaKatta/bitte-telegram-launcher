// Top-level launcher composing all the modules.

import { launchDiscord, type DiscordBotHandle, type DiscordLaunchOptions } from "./discord.js";
import { launchTelegram, type TelegramBotHandle, type TelegramLaunchOptions } from "./telegram.js";
import type { LauncherOptions } from "./types.js";

export type LauncherHandle = TelegramBotHandle | DiscordBotHandle;

export class BitteLauncher {
  /**
   * Run the launcher on the chosen platform.
   *
   * On Telegram you get a TelegramBotHandle (full feature set). On Discord
   * you get a DiscordBotHandle (minimal scaffold). Both expose the same
   * underlying proxy / guard / trace plumbing for inspection.
   */
  static async run(opts: LauncherOptions & Partial<TelegramLaunchOptions> & Partial<DiscordLaunchOptions>): Promise<LauncherHandle> {
    if (opts.platform === "telegram") {
      return launchTelegram(opts);
    }
    if (opts.platform === "discord") {
      return launchDiscord(opts);
    }
    throw new Error(`unsupported platform: ${(opts as { platform: string }).platform}`);
  }
}

export { launchTelegram, launchDiscord };
export type { TelegramBotHandle, DiscordBotHandle, TelegramLaunchOptions, DiscordLaunchOptions };
