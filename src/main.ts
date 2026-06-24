/**
 * Minecraft bot entry point that uses a custom navigation system.
 * The bot responds to chat commands to navigate to coordinates, follow players,
 * or stop its current movement.
 * 
 * @author Vectorted
 * @github https://github.com/Vectorted
 * 
 */

import mineflayer from 'mineflayer';
import { System } from './module/system/System.js';
import { GoalNear, GoalFollow } from './module/goals/Goal.js';
import { type NavigationConfig } from './module/config/NavigationConfig.js';

/**
 * Create the mineflayer bot instance with connection parameters.
 * @type {mineflayer.Bot}
 */
const bot: mineflayer.Bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'Bot'
});

/**
 * Event handler that executes once the bot successfully spawns into the world.
 * Initializes the navigation system and sets up chat command listeners.
 */
bot.once('spawn', async () => {
    await bot.waitForChunksToLoad();

    /**
     * Shared navigation configuration that defines bot behaviour across all goals.
     * @type {NavigationConfig}
     */
    const Action: NavigationConfig = {
        /** List of block names the bot can use for building bridges and towers. */
        allowedBuildBlocks: ['dirt', 'cobblestone', 'stone'],
        /** Whether the bot is allowed to sprint (may increase hunger drain). */
        allowSprint: true,
        /** Whether the bot automatically attacks hostile mobs within range. */
        killAura: true,
        /** Whether the bot avoids monsters during pathfinding. */
        evadeMonsters: true,
        /** List of player names the bot should avoid during navigation. */
        evadePlayers: [],
        /** Whether the bot automatically eats when hunger or health is low. */
        autoEat: true,
        /** Hunger level (0-20) that triggers auto-eating. Default is 10. */
        autoEatThreshold: 10,
        /** Health level (0-20) that triggers auto-eating. Default is 10. */
        autoEatHealthThreshold: 10,
        /** Ordered list of food items the bot is allowed to consume, in priority order. */
        allowedFoodList: [
            'golden_apple',           // Golden apple - highest priority for critical situations
            'enchanted_golden_apple', // Enchanted golden apple
            'cooked_beef',            // Cooked beef
            'cooked_porkchop',        // Cooked porkchop
            'baked_potato',           // Baked potato
            'bread',                  // Bread
            'cooked_mutton',          // Cooked mutton
            'cooked_chicken',         // Cooked chicken
            'golden_carrot',          // Golden carrot
            'apple'                   // Apple - lowest priority
        ]
    };

    /**
     * Main navigation system instance that controls the bot's movement and pathfinding.
     * @type {System}
     */
    const system: System = new System(bot);

    /**
     * Callback triggered when the bot dies.
     * Logs the event to the console.
     */
    system.onDeath(() => {
        console.log('bot dead.');
    });

    /**
     * Callback triggered when navigation status changes.
     * Sends a chat message to indicate success or failure.
     * @param {string} status - The navigation status ('success' or error message).
     */
    system.onNavigationStatus((status) => {
        if (status === 'success') {
            bot.chat('Goal Ok.');
            return;
        }
        bot.chat(status);
    });

    /**
     * Chat command listener that processes user commands.
     * Ignores messages sent by the bot itself.
     * 
     * Supported commands:
     * - "stop" : Stops the current navigation.
     * - "follow" : Follows the player who sent the command.
     * - "goto x y z" : Navigates to the specified coordinates.
     */
    bot.on('chat', async (username, message) => {
        if (username === bot.username) return;

        if(message === 'quit' || message === 'exit') {
            system.destroy();
            bot.quit();
        }

        /**
         * Command: stop navigation
         */
        if (message === 'stop') {
            system.stop();
        }

        /**
         * Command: follow the player who issued the command
         */
        if (message === 'follow') {
            const player = bot.players[username].entity;
            const followGoal = new GoalFollow(player, 2, Action);
            system.setGoal(followGoal);
        }

        /**
         * Command: navigate to specific coordinates
         * @example "goto 100 64 200"
         */
        if (message.startsWith('goto')) {
            const args = message.split(' ');
            const x = Number(args[1]);
            const y = Number(args[2]);
            const z = Number(args[3]);

            const goal = new GoalNear(x, y, z, 2, Action);
            system.setGoal(goal);

            bot.chat(`Point = (${x}, ${y}, ${z})`);
        }
    });
});
