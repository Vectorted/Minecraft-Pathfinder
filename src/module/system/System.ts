/**
 * Core Bot behavior implementation, used for more precise control of Bot actions.
 * 
 * @author Vectorted
 * @github https://github.com/Vectorted
 * 
 */

import mineflayer from 'mineflayer' 
import { Vec3 } from 'vec3' 
import { NavigationProcess } from '../NavigationProcess.js'
import { GoalBlock } from '../goals/Goal.js'
import { DEFAULT_NAV_CONFIG } from '../config/NavigationConfig.js'

/**
 * Core management system coordinating navigation operations, tick events, auto-eating,
 * water bucket fall recovery (MLG), defensive posture combat, and movement corrections.
 */
export class System {
    /**
     * Managed Mineflayer bot instance utilized for scene scanning, sensory queries,
     * inventory manipulation, control inputs, and interaction tasks.
     */
    public readonly bot: mineflayer.Bot;

    /**
     * Set containing coordinates of blocks placed by the bot during scaffolding or bridging.
     * Stored as string representations ("x,y,z") to avoid placement duplication.
     */
    public readonly placedBlocks = new Set<string>();
    
    /**
     * Target coordinate parameter representing the destination node of the current walking sequence.
     * Evaluates to null when there is no active walking node target.
     */
    public activeWalkTarget: Vec3 | null = null;

    /**
     * Reference pointing to the active navigation process task instance.
     * Evaluates to null when the bot is idle, standing, or not actively tracking a goal.
     */
    public activeProcess: NavigationProcess | null = null;

    /**
     * State flag indicating whether an emergency water bucket drop (MLG) procedure
     * is currently running to prevent fall damage.
     */
    public mlgActive = false; 

    /**
     * State flag denoting if the bot is currently performing an obstacle clearing dig.
     * Prevents look overrides and walk commands from interrupting block mining.
     */
    public isDiggingObstacle = false;

    /**
     * Bound callback reference pointing to the physics tick execution handler.
     * Maintained to coordinate safe binding and unbinding of event listeners.
     */
    private readonly onPhysicsTickBound: () => void;

    /**
     * Bound callback reference pointing to the bot death execution handler.
     */
    private readonly onDeathBound: () => void;

    /**
     * Optional callback invoked when a navigation trajectory completes, halts, or encounters failure.
     */
    private navigationCallback: ((status: 'success' | 'failure' | 'stopped', goal: GoalBlock, process: NavigationProcess) => void) | null = null;

    /**
     * Optional callback invoked when the bot entity triggers a death lifecycle event.
     */
    private deathCallback: (() => void) | null = null;

    /**
     * Timestamp mapping the last instant a combat attack transaction was performed.
     * Enforces the default cool-down limit to maximize weapon damage efficiency.
     */
    private lastAttackTime = 0;

    /**
     * State flag indicating if an attack movement index sequence is running.
     */
    private isAttacking = false;

    /**
     * State flag denoting if the bot is currently eating.
     * When true, disables movement inputs to prevent interrupting the eating sequence.
     */
    public isEating = false;

    /**
     * Target entity currently being tracked during entity follow tasks.
     */
    public followingEntity: any = null;

    /**
     * Distance range criteria limit for trailing the followed target entity.
     */
    public followingRange = 2.0;

    /**
     * Optional configuration parameters used to override follow navigation settings.
     */
    public followingConfig: any = null;

    /**
     * Reference coordinate vector representing the position of the target at the time of the last replan.
     */
    public lastPlannedTargetPos: Vec3 | null = null;

    /**
     * Goal class reference used to request path recalculations for the active goal.
     */
    public followGoalClass: any = null;

    /**
     * Timestamp mapping the last replanning check performed during target follow operations.
     */
    private lastFollowReplanTime = 0;

    /**
     * Initial parent navigation process initiated before follow replanning segments.
     */
    public rootFollowProcess: NavigationProcess | null = null;

    /**
     * Internal transition state flag checking if stop is initiated by system replan routines.
     */
    private isReplanTransition = false;

    /**
     * Internal transition state flag checking if stop is initiated by target range reached routines.
     */
    private isFollowReachedTransition = false;

    /**
     * Initializes the system instance, binds local event handlers, and attaches listener hooks to physics ticks.
     * @param bot Mineflayer bot boundary interface.
     */
    constructor(bot: mineflayer.Bot) { 
        this.bot = bot;
        
        this.onPhysicsTickBound = this.handlePhysicsTick.bind(this);
        this.bot.on('physicsTick', this.onPhysicsTickBound);

        this.onDeathBound = this.handleDeath.bind(this);
        this.bot.on('death', this.onDeathBound);
    } 

    /**
     * Registers a callback listener to monitor navigation lifecycle events.
     * @param callback Delegate triggered when the bot completes, stops, or fails navigation.
     */
    public onNavigationStatus(callback: (status: 'success' | 'failure' | 'stopped', goal: GoalBlock, process: NavigationProcess) => void): void {
        this.navigationCallback = callback;
    }

    /**
     * Registers a callback listener triggered when the bot dies.
     * @param callback Callback function.
     */
    public onDeath(callback: () => void): void {
        this.deathCallback = callback;
    }

    /**
     * Gets the currently active execution process container.
     * @returns Target active process or null.
     */
    public getProcess(): NavigationProcess | null {
        return this.activeProcess;
    }

    /**
     * Terminates active path tracking cycles and cleans up tick and death update event listener hooks.
     */
    public destroy(): void {
        this.stopNavigation();
        this.bot.removeListener('physicsTick', this.onPhysicsTickBound);
        this.bot.removeListener('death', this.onDeathBound);
    }

    /**
     * Suspends thread execution for a designated quantity of milliseconds.
     * @param ms Target freeze interval duration.
     */
    public static async delay(ms: number): Promise<void> { 
        return new Promise(resolve => setTimeout(resolve, ms)); 
    } 

    /**
     * Computes the vertical boundaries of the world based on the active registry dimension configs.
     * @returns Coordinate boundaries containing vertical maximum and minimum coordinate limits.
     */
    public getWorldHeightLimits(): { minHeight: number; maxHeight: number } {
        try {
            const registry = this.bot.registry as any;
            if (registry) {
                const dimensionName = this.bot.game.dimension; 
                let dimensionData = null;

                if (registry.dimensionsByName && registry.dimensionsByName[dimensionName]) {
                    dimensionData = registry.dimensionsByName[dimensionName];
                } else if (Array.isArray(registry.dimensions)) {
                    dimensionData = registry.dimensions.find((d: any) => d.name === dimensionName);
                } else if (registry.dimensions && typeof registry.dimensions === 'object') {
                    dimensionData = registry.dimensions[dimensionName];
                }

                if (dimensionData) {
                    const minHeight = dimensionData.minY ?? 0;
                    const maxHeight = minHeight + (dimensionData.height ?? 256);
                    return { minHeight, maxHeight };
                }
            }
        } catch (e) {}

        const dimensionRaw = this.bot.game.dimension;
        const dimStr = String(dimensionRaw).toLowerCase();

        if (dimStr.includes('nether') || (dimensionRaw as any) === -1 || dimStr === '-1') {
            return { minHeight: 0, maxHeight: 128 };
        } else if (dimStr.includes('end') || (dimensionRaw as any) === 1 || dimStr === '1') {
            return { minHeight: 0, maxHeight: 256 };
        }
        
        const protocolVersion = (this.bot.registry as any)?.version?.value;
        const isPost118 = protocolVersion ? protocolVersion >= 757 : false;

        return isPost118 ? { minHeight: -64, maxHeight: 320 } : { minHeight: 0, maxHeight: 256 };
    }

    /**
     * Resolves localized fluid depth level metadata for a target block representation.
     * @param block Coordinate block details structure.
     * @returns Water metadata level or undefined.
     */
    private getWaterLevel(block: any): number | undefined {
        if (!block) return undefined;
        const props = typeof block.getProperties === 'function' 
            ? block.getProperties() 
            : block.properties;
        
        const levelRaw = props ? props.level : block.metadata;
        return levelRaw !== undefined ? Number(levelRaw) : undefined;
    }

    /**
     * Checks if the bot is currently holding a specified item in its main hand.
     * @param itemName Name identifier matching the target item type.
     * @returns True if equipped, false otherwise.
     */
    private isHoldingItem(itemName: string): boolean {
        return this.bot.heldItem ? this.bot.heldItem.name === itemName : false;
    }

    /**
     * Counts the total items inside inventory matching the values defined on a target whitelist.
     * @param allowedBlocksWhiteList String identities representing targets.
     * @returns Total count indexes present.
     */
    public countPlaceableBlocks(allowedBlocksWhiteList: string[]): number {
        const items = this.bot.inventory.items();
        let total = 0;
        const lowercaseWhitelist = allowedBlocksWhiteList.map(w => w.toLowerCase());

        for (let i = 0; i < items.length; i++) {
            const name = items[i].name.toLowerCase();
            if (lowercaseWhitelist.includes(name)) {
                total += items[i].count;
            }
        }
        return total;
    }

    /**
     * Scans inventory items to determine which allowed block item type is most abundant.
     * @param allowedBlocksWhiteList Permissible block string name array.
     * @returns The name of the best block type, or null if none are found.
     */
    public findBestBuildBlock(allowedBlocksWhiteList: string[]): string | null {
        const items = this.bot.inventory.items();
        let bestItem: any = null;
        const lowercaseWhitelist = allowedBlocksWhiteList.map(w => w.toLowerCase());

        for (let i = 0; i < items.length; i++) {
            const name = items[i].name.toLowerCase();
            if (lowercaseWhitelist.includes(name)) {
                if (!bestItem || items[i].count > bestItem.count) {
                    bestItem = items[i];
                }
            }
        }
        return bestItem ? bestItem.name : null;
    }

    /**
     * Executes health and food level evaluations to equip and consume food sources automatically.
     */
    public async checkAndEat(): Promise<void> {
        if (this.isEating || this.mlgActive) return;

        const currentFood = this.bot.food;
        const currentHealth = this.bot.health;
        
        if (currentFood === undefined || currentFood === null || currentHealth === undefined || currentHealth === null) return;

        const config = this.activeProcess?.goal?.config ?? DEFAULT_NAV_CONFIG;
        const foodThreshold = config.autoEatThreshold ?? DEFAULT_NAV_CONFIG.autoEatThreshold;
        const healthThreshold = config.autoEatHealthThreshold ?? DEFAULT_NAV_CONFIG.autoEatHealthThreshold;
        
        const items = this.bot.inventory.items();
        const whitelist = config.allowedFoodList ?? DEFAULT_NAV_CONFIG.allowedFoodList;

        const availableFoods = items.filter(item => whitelist.includes(item.name));
        if (availableFoods.length === 0) return;

        let targetFood: any = null;

        if (currentHealth <= healthThreshold && currentFood >= 20) {
            targetFood = availableFoods.find(item => ['golden_apple', 'enchanted_golden_apple'].includes(item.name));
        } else if (currentFood <= foodThreshold || currentHealth <= healthThreshold) {
            targetFood = availableFoods.sort((a, b) => whitelist.indexOf(a.name) - whitelist.indexOf(b.name))[0];
        }

        if (!targetFood) return;

        this.isEating = true;
        this.clearControlStates();

        try {
            await this.bot.equip(targetFood, 'hand');
            await System.delay(100);
            await this.bot.consume();
        } catch (err: any) {
        } finally {
            this.isEating = false;
        }
    }

    /**
     * Targets and attacks the nearest hostile monster type using the best weapon available in inventory.
     */
    public async autoAttackNearestHostile(): Promise<void> {
        if (this.isAttacking || this.mlgActive || this.isEating) return;

        const botPos = this.bot.entity.position;
        if (!botPos) return;

        let closestMonster: any = null;
        let bestDist = 4.2; 

        const hostiles = [
            'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman',
            'phantom', 'drowned', 'husk', 'stray', 'pillager', 'ravager',
            'piglin', 'hoglin', 'wither', 'blaze', 'ghast', 'slime',
            'magma', 'shulker', 'silverfish', 'evoker', 'vex', 'guardian',
            'warden'
        ];

        const entities = this.bot.entities;
        for (const id in entities) {
            const entity = entities[id];
            if (!entity || !entity.position || entity === this.bot.entity) continue;
            if ((entity as any).isValid === false) continue; 

            const displayName = ((entity as any).displayName || (entity as any).name || '').toLowerCase();
            const isHostile = hostiles.some(type => displayName.includes(type));

            if (isHostile) {
                const dist = botPos.distanceTo(entity.position);
                if (dist < bestDist) {
                    bestDist = dist;
                    closestMonster = entity;
                }
            }
        }

        if (!closestMonster) return;

        this.isAttacking = true;

        try {
            const currentItem = this.bot.heldItem;
            const isWieldingWeapon = currentItem && (
                currentItem.name.includes('sword') || 
                currentItem.name.includes('axe') || 
                currentItem.name.includes('pickaxe') || 
                currentItem.name.includes('shovel')
            );

            if (!isWieldingWeapon) {
                const items = this.bot.inventory.items();
                const bestWeapon = items.find(i => i.name.includes('sword')) ||
                                   items.find(i => i.name.includes('axe')) ||
                                   items.find(i => i.name.includes('pickaxe')) ||
                                   items.find(i => i.name.includes('shovel'));
                
                if (bestWeapon) {
                    await this.bot.equip(bestWeapon, 'hand');
                    await System.delay(50); 
                }
            }
        } catch (equipErr) {}

        try {
            const headHeight = this.bot.entity.height ?? 1.6;
            const targetHeight = closestMonster.height ?? 1.8;
            const targetPos = closestMonster.position.offset(0, targetHeight * 0.75, 0);

            const dx = targetPos.x - botPos.x;
            const dy = targetPos.y - (botPos.y + headHeight);
            const dz = targetPos.z - botPos.z;

            const yaw = Math.atan2(-dx, -dz);
            const pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));

            await this.bot.look(yaw, pitch, true);
            this.bot.attack(closestMonster);
            
            this.lastAttackTime = Date.now();
        } catch (attackErr) {
        } finally {
            this.isAttacking = false;
        }
    }

    /**
     * Determines whether a block target contains active, flowing liquid water.
     * @param block Target query block.
     * @returns True if coordinate matches flowing liquid rules, false otherwise.
     */
    public isFlowingWater(block: any): boolean {
        if (!block) return false;
        const name = block.name.toLowerCase();
        if (!name.includes('water')) return false;

        const level = this.getWaterLevel(block);
        return level !== undefined && level !== 0; 
    }

    /**
     * Determines whether a block target contains static source liquid water.
     * @param block Coordinate block representation.
     * @returns True if coordinate matches static liquid source rules, false otherwise.
     */
    public isStaticWater(block: any): boolean {
        if (!block) return false;
        const name = block.name.toLowerCase();
        if (!name.includes('water')) return false;

        const level = this.getWaterLevel(block);
        return level === 0 || level === undefined;
    }

    /**
     * Resolves the nearest liquid source coordinate index matching target distance checks.
     * @param center Source scanning origin.
     * @param maxDistance Radius bounding criteria.
     * @returns Vec3 index path target of source, or null.
     */
    public findNearestWaterSource(center: Vec3, maxDistance = 3.5): Vec3 | null {
        let bestPos: Vec3 | null = null;
        let bestDist = maxDistance;

        const checkRadius = Math.ceil(maxDistance);
        for (let x = -checkRadius; x <= checkRadius; x++) {
            for (let y = -2; y <= 2; y++) {
                for (let z = -checkRadius; z <= checkRadius; z++) {
                    const checkPos = center.offset(x, y, z).floored();
                    const block = this.bot.blockAt(checkPos);
                    if (block && block.name.toLowerCase().includes('water')) {
                        const level = this.getWaterLevel(block);
                        if (level === 0 || level === undefined) {
                            const dist = center.distanceTo(checkPos.offset(0.5, 0.5, 0.5));
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestPos = checkPos;
                            }
                        }
                    }
                }
            }
        }
        return bestPos;
    }

   /**
     * Commands the pathfinding system to execute a route configuration towards a designated target Goal.
     * @param goal The target objective configuration.
     * @param isReplan Flags internal path update step during continuous tracking.
     * @returns Output navigation track task control.
     */
    public navigateTo(goal: GoalBlock, isReplan = false): NavigationProcess {
        if (!isReplan) {
            this.stopNavigation(); 
        } else {
            if (this.activeProcess) {
                this.isReplanTransition = true;
                this.activeProcess.stop();
                this.activeProcess = null;
                this.isReplanTransition = false;
            }
        }
        
        if (goal && (goal.constructor.name === 'GoalFollow' || ('entity' in goal && 'range' in goal))) {
            this.followingEntity = (goal as any).entity;
            this.followingRange = (goal as any).range;
            this.followingConfig = goal.config;
            this.lastPlannedTargetPos = (goal as any).entity?.position?.clone() || null;
            this.followGoalClass = goal.constructor; 
        } else {
            this.followingEntity = null;
            this.lastPlannedTargetPos = null;
            this.followGoalClass = null;
            this.rootFollowProcess = null;
        }

        const process = new NavigationProcess(this, goal);
        this.activeProcess = process;

        if (!isReplan && this.followingEntity) {
            this.rootFollowProcess = process;
        }

        const originalProcessStop = (process as any).stop;
        if (typeof originalProcessStop === 'function') {
            (process as any).stop = () => {
                originalProcessStop.call(process);
                
                if (!this.isReplanTransition && !this.isFollowReachedTransition) {
                    if (this.rootFollowProcess === process || this.activeProcess === process) {
                        this.followingEntity = null;
                        this.lastPlannedTargetPos = null;
                        this.followGoalClass = null;
                        this.rootFollowProcess = null;
                        this.clearControlStates();

                        if (this.activeProcess && this.activeProcess !== process) {
                            const subProcess = this.activeProcess;
                            this.activeProcess = null;
                            subProcess.stop();
                        }
                    }
                }
            };
        }
        
        process.execute()
            .then((success) => {
                let eventStatus: 'success' | 'failure' | 'stopped';
                
                if (success) {
                    eventStatus = 'success';
                } else {
                    const finalStatus = process.getStatus();
                    if (finalStatus === 'COMPLETED') {
                        eventStatus = 'success';
                    } else if (finalStatus === 'CANCELLED') {
                        eventStatus = 'stopped';
                    } else {
                        eventStatus = 'failure';
                    }
                }

                if (this.isReplanTransition) {
                    return;
                }

                if (eventStatus === 'stopped' && this.activeProcess !== null && this.activeProcess !== process) {
                    return;
                }

                if (this.isFollowReachedTransition && eventStatus === 'stopped') {
                    eventStatus = 'success';
                }

                if (this.navigationCallback) {
                    this.navigationCallback(eventStatus, goal, process);
                }
            })
            .catch(() => {
                if (!this.isReplanTransition && this.navigationCallback) {
                    this.navigationCallback('failure', goal, process);
                }
            });

        return process;
    }

    /**
     * Clears local target follows, cancels active navigation task execution, and resets movements.
     */
    public stopNavigation(): void {
        if (this.activeProcess) {
            this.activeProcess.stop();
            this.activeProcess = null;
        }
        this.clearControlStates();
        
        this.followingEntity = null;
        this.lastPlannedTargetPos = null;
        this.followGoalClass = null;
        this.rootFollowProcess = null;
        this.isEating = false; 
    }

    /**
     * Resets motion control switches to release key bindings and nullify dynamic walk bounds.
     */
    public clearControlStates(): void {
        this.bot.setControlState('forward', false);
        this.bot.setControlState('back', false);
        this.bot.setControlState('left', false);
        this.bot.setControlState('right', false);
        this.bot.setControlState('jump', false);
        this.bot.setControlState('sneak', false);
        this.bot.setControlState('sprint', false);
        this.activeWalkTarget = null;
    }

    /**
     * Finds and equips an inventory item matching the target identifier to the hand slot.
     * @param itemId String identifier representing target slot items.
     * @returns A promise resolving to true if target items successfully swap.
     */
    public async equipItemByName(itemId: string): Promise<boolean> { 
        const item = this.bot.inventory.items().find(item => item.name === itemId) 
        if (!item) return false
        await this.bot.equip(item, 'hand') 
        return true
    } 

    /**
     * Determines whether a block targets an obstructive block (like cobwebs or fences) that needs to be cleared.
     * @param block Target query block.
     * @returns True if the block is considered an obstacle.
     */
    private isObstructiveBlock(block: any): boolean {
        if (!block) return false;
        const name = block.name.toLowerCase();
        return name.includes('web') || 
               name.includes('fence') || 
               name.includes('gate') || 
               name.includes('wall');
    }

    /**
     * Determines whether a block is a hard/solid physical obstacle.
     * @param block Target query block.
     * @returns True if the block has physical collision box.
     */
    private isHardObstacle(block: any): boolean {
        if (!block) return false;
        const name = block.name.toLowerCase();
        const isFluidOrAir = ['air', 'cave_air', 'void_air', 'water', 'flowing_water', 'stationary_water', 'lava', 'bubble_column'].includes(name);
        return !isFluidOrAir && !this.isTransparentBlock(block);
    }

    /**
     * Moves to focus and excavate target blocks placed on targeted grids.
     * @param pos Location index parameters of the target block.
     */
    public async digBlockAt(pos: Vec3): Promise<void> { 
        let block = this.bot.blockAt(pos, true); 
        this.placedBlocks.delete(pos.toString());

        if (block) { 
            const isObstructive = this.isObstructiveBlock(block);
            if (this.bot.canDigBlock(block) || isObstructive) {
                this.isDiggingObstacle = true;
                this.clearControlStates();

                const bestTool = this.findBestToolForBlock(block);
                if (bestTool) {
                    try {
                        await this.bot.equip(bestTool, 'hand');
                        await System.delay(50);
                    } catch (e) {}
                }

                for (let i = 0; i < 3; i++) {
                    await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
                    await System.delay(30);
                }
                
                try {
                    await this.bot.dig(block);
                } catch (err: any) {
                } finally {
                    this.isDiggingObstacle = false;
                }
            }
        } 
    } 

   /**
     * Finds the best harvesting tool in the bot's inventory for the target block.
     * @param block Target block to harvest.
     * @returns The best tool item found, or null if no specific tool is available.
     */
    private findBestToolForBlock(block: any): any {
        const name = block.name.toLowerCase();
        const items = this.bot.inventory.items();
        
        if (name.includes('web')) {
            return items.find(item => item.name.includes('sword')) || 
                   items.find(item => item.name.includes('shears')) || 
                   null;
        }

        let toolType = '';
        if (
            name.includes('stone') || 
            name.includes('ore') || 
            name.includes('granite') || 
            name.includes('diorite') || 
            name.includes('andesite') || 
            name.includes('basalt') || 
            name.includes('deepslate') || 
            name.includes('obsidian') || 
            name.includes('concrete') || 
            name.includes('terracotta') || 
            name.includes('brick') || 
            name.includes('cobblestone') ||
            name.includes('wall')
        ) {
            toolType = 'pickaxe';
        } else if (
            name.includes('dirt') || 
            name.includes('grass') || 
            name.includes('sand') || 
            name.includes('gravel') || 
            name.includes('clay') || 
            name.includes('snow')
        ) {
            toolType = 'shovel';
        } else if (
            name.includes('wood') || 
            name.includes('planks') || 
            name.includes('log') || 
            name.includes('chest') || 
            name.includes('crafting_table') ||
            name.includes('fence') ||
            name.includes('gate')
        ) {
            toolType = 'axe';
        }

        if (!toolType) return null;

        const priority = ['netherite', 'diamond', 'iron', 'golden', 'stone', 'wooden'];
        const candidateTools = items.filter(item => item.name.includes(toolType));
        
        if (candidateTools.length === 0) return null;

        candidateTools.sort((a, b) => {
            const aIndex = priority.findIndex(p => a.name.includes(p));
            const bIndex = priority.findIndex(p => b.name.includes(p));
            return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
        });

        return candidateTools[0];
    }

    /**
     * Assesses whether a block represents transparent structure paths lacking physical collision bounds.
     * @param block Target query block.
     * @returns True if coordinate poses no collision threat.
     */
    public isTransparentBlock(block: any): boolean {
        if (!block) return false;
        const name = block.name.toLowerCase();
        if (['air', 'cave_air', 'void_air', 'water', 'flowing_water', 'stationary_water', 'lava', 'bubble_column'].includes(name)) return false;
        if (name.includes('azalea')) return false;

        const excludeList = ['grass_block', 'moss_block', 'crimson_nylium', 'warped_nylium', 'podzol', 'muddy_mangrove_roots'];
        if (excludeList.includes(name)) return false;

        const plantKeywords = [
            'grass', 'flower', 'fern', 'rose', 'dandelion', 'orchid', 'tulip', 
            'daisy', 'sprout', 'bush', 'bamboo', 'sapling', 'lichen', 'vein', 
            'petal', 'carpet', 'lily', 'clover', 'vine', 'roots', 'mushroom', 
            'fungus', 'seagrass', 'kelp', 'crop', 'wheat', 'potato', 'carrot',
            'beetroot', 'pumpkin_stem', 'melon_stem', 'nether_wart', 'sugar_cane',
            'hanging_roots', 'spore_blossom', 'moss_carpet'
        ];

        const isPlantName = plantKeywords.some(keyword => name.includes(keyword));
        const isSnowOrFire = name === 'snow' || name.includes('fire');
        const isLowCollision = block.shapes ? (block.shapes.length === 0) : (block.boundingBox === 'empty');

        return isPlantName || isSnowOrFire || isLowCollision;
    }

    /**
     * Evaluates if the current spatial boundary index of the bot matches water immersion rules.
     * @returns True if bot is inside water.
     */
    public isBotInWater(): boolean {
        const botPos = this.bot.entity.position;
        if (!botPos) return false;
        
        const feetGrid = botPos.floored();
        const headGrid = feetGrid.offset(0, 1, 0);

        const feetBlk = this.bot.blockAt(feetGrid);
        const headBlk = this.bot.blockAt(headGrid);

        const isFeetWater = feetBlk ? feetBlk.name.toLowerCase().includes('water') || feetBlk.name.toLowerCase().includes('bubble_column') : false;
        const isHeadWater = headBlk ? headBlk.name.toLowerCase().includes('water') || headBlk.name.toLowerCase().includes('bubble_column') : false;

        return isFeetWater || isHeadWater;
    }

    /**
     * Routine assessing if structure properties of a target coordinate permit block placement.
     * @param pos Coordinate index locations checked.
     * @returns True if placement at pos will sit safely on collision grids.
     */
    public isBlockSafeForWater(pos: Vec3): boolean {
        const block = this.bot.blockAt(pos);
        if (!block) return false;

        const name = block.name.toLowerCase();

        const safeBlocks = [
            'grass_block', 'dirt', 'coarse_dirt', 'stone', 'cobblestone',
            'deepslate', 'netherrack', 'end_stone', 'sand', 'gravel',
            'clay', 'moss_block', 'andesite', 'diorite', 'granite',
            'sandstone', 'terracotta', 'concrete', 'planks', 'obsidian',
            'basalt', 'blackstone', 'bricks', 'ore'
        ];

        if (safeBlocks.some(safe => name.includes(safe))) return true;

        const unsafeKeywords = [
            'leaves', 'slab', 'stairs', 'fence', 'glass', 'ice',
            'carpet', 'farmland', 'path', 'snow', 'trapdoor', 'door',
            'gate', 'sign', 'chest', 'hopper', 'scaffolding', 'shulker', 'anvil',
            'dripstone', 'amethyst', 'coral', 'sponge', 'lily_pad'
        ];

        if (unsafeKeywords.some(unsafe => name.includes(unsafe))) return false;

        const hasCollision = block.boundingBox === 'block' && (block.shapes ? block.shapes.length > 0 : true);
        return hasCollision;
    }

    /**
     * Executes the water bucket MLG (Minecraft Good Luck) fall damage prevention procedure.
     * Attempts to place water beneath the bot during a fall and then collects it back.
     */
    private async performMlgDrop(): Promise<void> {
        if (this.mlgActive) return; 

        const botPos = this.bot.entity.position; 
        if (botPos) {
            let initialGroundDist = 999; 
            for (let y = 1; y <= 6; y++) { 
                const checkPos = botPos.offset(0, -y, 0).floored(); 
                const blk = this.bot.blockAt(checkPos); 
                if (blk && blk.name !== 'air' && blk.name !== 'cave_air' && !this.isTransparentBlock(blk)) { 
                    initialGroundDist = botPos.y - (blk.position.y + 1); 
                    break; 
                } 
            } 
            if (initialGroundDist < 3.5) {
                return;
            }
        }

        this.mlgActive = true; 
        this.clearControlStates(); 

        try { 
            const equipped = await this.equipItemByName('water_bucket'); 
            if (!equipped) { 
                this.mlgActive = false; 
                return; 
            } 

            const start = Date.now(); 
            while (Date.now() - start < 3000) { 
                const currentPos = this.bot.entity.position; 
                if (!currentPos) break; 

                this.bot.look(this.bot.entity.yaw ?? 0, -Math.PI / 2, true); 

                let groundDist = 999; 
                for (let y = 1; y <= 6; y++) { 
                    const checkPos = currentPos.offset(0, -y, 0).floored(); 
                    const blk = this.bot.blockAt(checkPos); 
                    if (blk && blk.name !== 'air' && blk.name !== 'cave_air' && !this.isTransparentBlock(blk)) { 
                        groundDist = currentPos.y - (blk.position.y + 1); 
                        break; 
                    } 
                } 

                if (groundDist <= 3.8 && this.isHoldingItem('water_bucket')) { 
                    this.bot.activateItem(false); 
                } 

                if (this.isBotInWater() || this.bot.entity.onGround) { 
                    break; 
                } 

                await System.delay(10); 
            } 

            await System.delay(120); 

            let bucketEquipped = false;
            for (let i = 0; i < 3; i++) {
                bucketEquipped = await this.equipItemByName('bucket');
                if (bucketEquipped) break;
                await System.delay(50);
            }

            if (bucketEquipped) { 
                for (let i = 0; i < 8; i++) { 
                    const currentPos = this.bot.entity.position; 
                    if (!currentPos) break; 

                    const sourcePos = this.findNearestWaterSource(currentPos, 3.5);
                    if (sourcePos) {
                        await this.bot.lookAt(sourcePos.offset(0.5, 0.2, 0.5), true); 
                        await System.delay(50); 
                        this.bot.activateItem(false); 
                    } else {
                        await this.bot.look(this.bot.entity.yaw ?? 0, -Math.PI / 2, true); 
                        await System.delay(30); 
                        this.bot.activateItem(false); 
                    }

                    await System.delay(80); 

                    const feetBlock = this.bot.blockAt(currentPos.floored()); 
                    const sourceStillExists = sourcePos ? this.bot.blockAt(sourcePos)?.name.toLowerCase().includes('water') : false;
                    
                    if (!sourceStillExists && (!feetBlock || !feetBlock.name.toLowerCase().includes('water'))) { 
                        break; 
                    } 
                } 
            } 
        } catch (err: any) { 
        } finally {
            this.mlgActive = false; 
        } 
    }

    /**
     * Private handler triggered by the mineflayer bot's death event.
     */
    private handleDeath(): void {
        this.stopNavigation();
        if (this.deathCallback) {
            this.deathCallback();
        }
    }

    /**
     * Private handler executed on each physics tick. Manages auto-eating, kill aura,
     * entity following, MLG fall detection, and jump assistance.
     */
    private handlePhysicsTick(): void {
        const botPos = this.bot.entity.position;
        const velocity = this.bot.entity.velocity;
        if (!botPos || !velocity) return;

        const config = this.activeProcess?.goal?.config ?? DEFAULT_NAV_CONFIG;

        if (config.autoEat && !this.isEating && !this.mlgActive && !this.isAttacking) {
            const currentFood = this.bot.food;
            const currentHealth = this.bot.health;
            
            if (currentFood !== undefined && currentHealth !== undefined) {
                const foodThreshold = config.autoEatThreshold ?? DEFAULT_NAV_CONFIG.autoEatThreshold;
                const healthThreshold = config.autoEatHealthThreshold ?? DEFAULT_NAV_CONFIG.autoEatHealthThreshold;

                const needsFood = currentFood <= foodThreshold;
                const needsHealing = currentHealth <= healthThreshold;

                if (needsFood || needsHealing) {
                    this.checkAndEat().catch(() => {});
                }
            }
        }

        if (config.killAura && !this.mlgActive && !this.isAttacking && !this.isEating) {
            const now = Date.now();
            if (now - this.lastAttackTime > 250) { 
                this.lastAttackTime = now;
                this.autoAttackNearestHostile().catch(() => {});
            }
        }

        if (this.followingEntity && !this.mlgActive) {
            const entityId = this.followingEntity.id;
            const isPresent = entityId !== undefined ? this.bot.entities[entityId] !== undefined : true;
            
            if (!isPresent) {
                this.stopNavigation();
                return;
            }

            const entPos = this.followingEntity.position;
            if (entPos) {
                const currentDist = botPos.distanceTo(entPos);
                
                if (currentDist > this.followingRange + 0.5) {
                    const now = Date.now();
                    const shouldReplan = !this.activeProcess || 
                        (this.lastPlannedTargetPos && entPos.distanceTo(this.lastPlannedTargetPos) > 2.0 && now - this.lastFollowReplanTime > 1000);

                    if (shouldReplan) {
                        this.lastFollowReplanTime = now;
                        this.lastPlannedTargetPos = entPos.clone();
                        if (this.followGoalClass) {
                            const newGoal = new this.followGoalClass(this.followingEntity, this.followingRange, this.followingConfig);
                            this.navigateTo(newGoal, true); 
                        }
                    }
                } else {
                    if (this.activeProcess) {
                        this.isFollowReachedTransition = true;
                        this.activeProcess.stop();
                        this.activeProcess = null;
                        this.clearControlStates();
                        this.isFollowReachedTransition = false;
                    }
                }
            }
        }

        const dimStr = String(this.bot.game.dimension).toLowerCase();
        const isNether = dimStr.includes('nether') || (this.bot.game.dimension as any) === -1 || dimStr === '-1';

        const isSuspendedInAir = !this.bot.entity.onGround && Math.abs(velocity.y) < 0.4 && botPos.y > this.getWorldHeightLimits().minHeight + 5;
        const isFallingFast = velocity.y < -0.58;

        if ((isFallingFast || isSuspendedInAir) && !this.mlgActive && !isNether) {
            const hasWaterBucket = this.bot.inventory.slots.some(slot => slot && slot.name === 'water_bucket');
            if (hasWaterBucket) {
                let landingBlock: Vec3 | null = null;
                let fallDistance = 0;

                for (let y = 1; y <= 20; y++) {
                    const checkPos = botPos.offset(0, -y, 0).floored();
                    const blk = this.bot.blockAt(checkPos);
                    if (blk && blk.name !== 'air' && blk.name !== 'cave_air' && !this.isTransparentBlock(blk)) {
                        landingBlock = checkPos;
                        fallDistance = botPos.y - (blk.position.y + 1);
                        break;
                    }
                }

                if (landingBlock && fallDistance >= 3.5 && this.isBlockSafeForWater(landingBlock)) {
                    this.performMlgDrop(); 
                }
            }
        }

        if (!this.activeWalkTarget) return;
        const inWater = this.isBotInWater();
        const targetIsHigher = this.activeWalkTarget.y > botPos.y + 0.18;

        if (targetIsHigher) {
            const dx = this.activeWalkTarget.x - botPos.x;
            const dz = this.activeWalkTarget.z - botPos.z;
            const distXZ = Math.sqrt(dx * dx + dz * dz);

            if (distXZ < 1.1 && botPos.y < this.activeWalkTarget.y) {
                if (inWater) {
                    this.bot.entity.velocity.y = Math.max(this.bot.entity.velocity.y, 0.24);
                    this.bot.entity.onGround = true; 
                } else {
                    if (this.activeWalkTarget.y - botPos.y <= 1.25) {
                        this.bot.entity.onGround = true;
                        this.bot.setControlState('jump', true);
                    }
                }
            }
        }
    }

    /**
     * Coordinates horizontal movements to center the bot on a designated target coordinate grid.
     * @param centerXZ Coordinate target positions matching block placement bounds.
     * @param process Active running process reference.
     * @param timeout The alignment sequence safety limit.
     * @returns A promise resolving to true if alignment succeeds.
     */
    public async alignToBlockCenter(centerXZ: Vec3, process?: NavigationProcess, timeout = 800): Promise<boolean> {
        this.clearControlStates();

        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (process?.isAborted()) return false;

            const botPos = this.bot.entity.position;
            if (!botPos) return false;

            const dx = centerXZ.x - botPos.x;
            const dz = centerXZ.z - botPos.z;
            const distXZ = Math.sqrt(dx * dx + dz * dz);

            if (distXZ < 0.08) {
                this.clearControlStates();
                this.bot.entity.velocity.x = 0;
                this.bot.entity.velocity.z = 0;
                await System.delay(20);
                return true; 
            }

            const useSneak = distXZ < 0.28 && !this.isBotInWater();
            this.bot.setControlState('sneak', useSneak);

            if (distXZ > 0.12) {
                const yaw = Math.atan2(-dx, -dz);
                this.bot.look(yaw, 0, true);
            }
            
            this.bot.setControlState('forward', true);
            await System.delay(20);
        }

        this.clearControlStates();
        this.bot.entity.velocity.x = 0;
        this.bot.entity.velocity.z = 0;

        const finalPos = this.bot.entity.position;
        if (finalPos) {
            const finalDist = Math.sqrt(Math.pow(centerXZ.x - finalPos.x, 2) + Math.pow(centerXZ.z - finalPos.z, 2));
            return finalDist < 0.18;
        }

        return false;
    }

    /**
     * Loops code execution until vertical falling sequences register as completed.
     * @param targetY Target floor height index.
     * @param targetXZ Target destination plane coordinates.
     * @param process Active process task tracking context.
     * @param timeout Fall processing execution limit.
     * @returns A promise resolving to true if the fall completes successfully.
     */
    public async awaitFallCompletion(targetY: number, targetXZ: Vec3, process?: NavigationProcess, timeout = 6000): Promise<boolean> {
        const start = Date.now();
        this.bot.setControlState('jump', false);

        while (Date.now() - start < timeout) {
            if (process?.isAborted()) return false;

            const botPos = this.bot.entity.position;
            if (!botPos) return false;

            const diffY = botPos.y - targetY;
            const inWater = this.isBotInWater();

            if (inWater) {
                if (Math.abs(diffY) <= 0.25) { 
                    this.bot.setControlState('forward', false);
                    return true;
                }
            } else {
                if (Math.abs(diffY) <= 0.18 && this.bot.entity.onGround) {
                    this.bot.setControlState('forward', false);
                    return true;
                }
            }

            const dx = targetXZ.x - botPos.x;
            const dz = targetXZ.z - botPos.z;
            const distXZ = Math.sqrt(dx * dx + dz * dz);

            const isAirborn = !this.bot.entity.onGround;
            const isDescending = this.bot.entity.velocity.y < -0.1;

            if (distXZ > 0.08 && !this.mlgActive) {
                const yaw = Math.atan2(-dx, -dz);
                this.bot.look(yaw, 0, true);

                if (isAirborn && isDescending) {
                    this.bot.setControlState('forward', false); 
                } else {
                    this.bot.setControlState('forward', true);
                }
            } else {
                this.bot.setControlState('forward', false);
            }

            if (inWater && diffY < -0.1) {
                this.bot.setControlState('jump', true);
            }

            await System.delay(50);
        }
        this.bot.setControlState('forward', false);
        return this.bot.entity.onGround ?? false;
    }

    /**
     * Equips a whitelisted block and places it at the specified coordinate.
     * @param targetPos Target grid coordinate.
     * @param process Running navigation thread context instance.
     * @returns A promise resolving to true if block placement succeeds.
     */
    public async placeBlockAt(targetPos: Vec3, process: NavigationProcess): Promise<boolean> {
        if (process.isAborted()) return false;

        const { maxHeight } = this.getWorldHeightLimits();
        if (targetPos.y >= maxHeight) return false;

        const blockName = this.findBestBuildBlock(process.goal.config.allowedBuildBlocks);
        if (!blockName) return false;

        const equipped = await this.equipItemByName(blockName);
        if (!equipped) return false;

        const targetBlock = this.bot.blockAt(targetPos);
        if (targetBlock && this.isTransparentBlock(targetBlock)) {
            await this.digBlockAt(targetPos);
            await System.delay(50);
        }

        const currentBlock = this.bot.blockAt(targetPos);
        const hasCollision = currentBlock && (currentBlock.shapes ? currentBlock.shapes.length > 0 : currentBlock.boundingBox === 'block') && !this.isTransparentBlock(currentBlock);
        if (hasCollision) {
            return true; 
        }

        const checkOffsets = [
            new Vec3(0, -1, 0), 
            new Vec3(0, 0, -1), new Vec3(0, 0, 1), 
            new Vec3(-1, 0, 0), new Vec3(1, 0, 0),
            new Vec3(0, 1, 0)
        ];

        let referenceBlock: any = null;
        let faceVector: Vec3 = new Vec3(0, 1, 0);

        const isSolidSupport = (block: any) => {
            if (!block) return false;
            const valid = block.shapes ? (block.shapes.length > 0) : (block.boundingBox === 'block');
            return valid && !this.isTransparentBlock(block);
        }

        for (const offset of checkOffsets) {
            const checkPos = targetPos.plus(offset);
            
            if (this.placedBlocks.has(checkPos.toString())) {
                referenceBlock = this.bot.blockAt(checkPos) || { position: checkPos };
                faceVector = offset.scaled(-1);
                break;
            }

            const block = this.bot.blockAt(checkPos);
            if (block && isSolidSupport(block)) {
                referenceBlock = block;
                faceVector = offset.scaled(-1);
                break;
            }
        }

        if (!referenceBlock) return false;

        const lookTarget = referenceBlock.position.offset(0.5, 0.5, 0.5).plus(faceVector.scaled(0.5));
        const dest = referenceBlock.position.plus(faceVector);

        const spoofListener = () => {
            this.bot.world.emit(`blockUpdate:${dest.toString()}`, null, null)
        }
        this.bot.world.on(`blockUpdate:${referenceBlock.position.toString()}`, spoofListener)

        try {
            this.bot.setControlState('sneak', true);
            await this.bot.lookAt(lookTarget, true);
            await System.delay(50); 
            await this.bot.placeBlock(referenceBlock, faceVector);
            
            this.placedBlocks.add(dest.toString());
            return true;
        } catch (err: any) {
            return false;
        } finally {
            this.bot.setControlState('sneak', false);
            this.bot.world.removeListener(`blockUpdate:${referenceBlock.position.toString()}`, spoofListener)
        }
    }

    /**
     * Scaffolds blocks directly beneath the bot to build a temporary vertical column.
     * @param process Active tracking process context.
     * @returns A promise resolving to true if tower height escalation succeeds.
     */
    public async buildTowerUp(process: NavigationProcess): Promise<boolean> {
        const { maxHeight } = this.getWorldHeightLimits();
        const currentY = this.bot.entity.position.y;
        if (currentY + 1 >= maxHeight) return false;

        const blockName = this.findBestBuildBlock(process.goal.config.allowedBuildBlocks);
        if (!blockName) return false;

        const equipped = await this.equipItemByName(blockName);
        if (!equipped) return false;

        this.clearControlStates();

        const startPos = this.bot.entity.position.clone(); 
        const feetGrid = new Vec3( 
            Math.floor(startPos.x), 
            Math.floor(startPos.y - 0.1), 
            Math.floor(startPos.z) 
        ); 

        const upGrid = feetGrid.offset(0, 1, 0); 
        const upBlock = this.bot.blockAt(upGrid); 
        if (upBlock && this.isTransparentBlock(upBlock)) { 
            await this.digBlockAt(upGrid); 
            await System.delay(80); 
        } 

        const referenceBlock = this.bot.blockAt(feetGrid); 
        if (!referenceBlock || ['air', 'cave_air', 'void_air'].includes(referenceBlock.name) || this.isTransparentBlock(referenceBlock)) { 
            return false; 
        } 

        const dest = referenceBlock.position.offset(0, 1, 0); 

        const currentYaw = this.bot.entity.yaw ?? 0;
        const snappedYaw = Math.round(currentYaw / (Math.PI / 2)) * (Math.PI / 2);
        await this.bot.look(snappedYaw, -Math.PI / 2, true); 

        return new Promise<boolean>((resolve) => { 
            let placed = false; 

            const onTick = async () => { 
                if (process.isAborted()) {
                    this.bot.setControlState('jump', false);
                    this.bot.removeListener('physicsTick', onTick);
                    resolve(false);
                    return;
                }

                if (placed) return; 
                const currY = this.bot.entity.position.y; 
                const yDiff = currY - startPos.y; 

                if (yDiff >= 0.92) { 
                    placed = true; 
                    this.bot.setControlState('jump', false); 
                    this.bot.removeListener('physicsTick', onTick); 

                    const originalLookAt = this.bot.lookAt;
                    (this.bot as any).lookAt = async () => {}; 

                    try { 
                        await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0)); 
                        this.placedBlocks.add(dest.toString()); 
                        resolve(true); 
                    } catch (err: any) { 
                        resolve(false); 
                    } finally {
                        this.bot.lookAt = originalLookAt;
                    }
                } 
            }; 

            this.bot.on('physicsTick', onTick); 
            this.bot.setControlState('jump', true); 

            setTimeout(() => { 
                this.bot.setControlState('jump', false); 
                this.bot.removeListener('physicsTick', onTick); 
                resolve(false); 
            }, 1000); 
        }); 
    }

    /**
     * Bridges blocks toward path targets, stabilizing positioning beforehand.
     * @param targetPos Target horizontal placement index.
     * @param process Active running process.
     * @returns A promise resolving to true if bridge block placement succeeds.
     */
    public async bridgeToTarget(targetPos: Vec3, process: NavigationProcess): Promise<boolean> {
        if (process.isAborted()) return false;

        const botPos = this.bot.entity.position;
        if (!botPos) return false;

        const botGrid = botPos.floored();
        const targetGrid = targetPos.floored();

        const supportPos = botGrid.offset(0, -1, 0); 
        const supportBlock = this.bot.blockAt(supportPos);
        if (!supportBlock || supportBlock.name === 'air' || this.isTransparentBlock(supportBlock)) {
            return false;
        }

        const dx = targetGrid.x - botGrid.x;
        const dz = targetGrid.z - botGrid.z;
        let bridgeDir = new Vec3(0, 0, 0);
        if (Math.abs(dx) > Math.abs(dz)) {
            bridgeDir.x = dx > 0 ? 1 : -1;
        } else {
            bridgeDir.z = dz > 0 ? 1 : -1;
        }

        const destPos = supportPos.plus(bridgeDir);
        const destBlock = this.bot.blockAt(destPos);

        const hasCollision = destBlock && (destBlock.shapes ? destBlock.shapes.length > 0 : destBlock.boundingBox === 'block') && !this.isTransparentBlock(destBlock);
        if (hasCollision) {
            return await this.walkToTarget(targetPos, process, 1500);
        }

        const blockName = this.findBestBuildBlock(process.goal.config.allowedBuildBlocks);
        if (!blockName) return false;

        const equipped = await this.equipItemByName(blockName);
        if (!equipped) return false;

        this.clearControlStates();

        const center = supportPos.offset(0.5, 1.0, 0.5); 
        await this.alignToBlockCenter(center, process, 800);

        const currentPosNow = this.bot.entity.position.clone();
        const lookTarget = currentPosNow.plus(bridgeDir.scaled(-2.0)).offset(0, -1.2, 0);
        
        await this.bot.lookAt(lookTarget, true);
        await System.delay(150); 

        const targetYaw = this.bot.entity.yaw;
        const targetPitch = this.bot.entity.pitch;

        this.bot.setControlState('sneak', true);
        await System.delay(100); 

        this.bot.setControlState('back', true);

        const startBack = Date.now();
        let backedEnough = false;

        while (Date.now() - startBack < 1200) {
            if (process.isAborted()) {
                this.clearControlStates();
                return false;
            }

            await this.bot.look(targetYaw, targetPitch, true);

            const currentPos = this.bot.entity.position;
            if (!currentPos) break;

            const distFromCent = currentPos.minus(center);
            const projection = distFromCent.dot(bridgeDir); 

            if (projection >= 0.46) {
                backedEnough = true;
                break;
            }
            await System.delay(20);
        }

        this.bot.setControlState('back', false);
        if (!backedEnough) {
            this.bot.setControlState('sneak', false);
            return false;
        }

        const faceCenter = supportPos.offset(0.5, 0.5, 0.5).plus(bridgeDir.scaled(0.5));
        await this.bot.lookAt(faceCenter, true);
        await System.delay(100);

        let placed = false;
        try {
            await this.bot.placeBlock(supportBlock, bridgeDir);
            this.placedBlocks.add(destPos.toString());
            placed = true;
        } catch (err: any) {
            placed = false;
        }

        await System.delay(100); 
        this.bot.setControlState('sneak', false);

        if (placed) {
            return await this.walkToTarget(targetPos, process, 1500);
        }

        return false;
    }

    /**
     * Active stuck recovery routine: Scans surrounding space, finds the closest hard physical/obstructive
     * blocks keeping the bot from executing movement, and digs them out to escape.
     */
    private async recoverFromStuck(): Promise<void> {
        const botPos = this.bot.entity.position;
        if (!botPos) return;

        const basePos = botPos.floored();
        
        const checkOffsets = [
            new Vec3(0, 0, 0),
            new Vec3(0, 1, 0),
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
            new Vec3(1, 1, 0), new Vec3(-1, 1, 0), new Vec3(0, 1, 1), new Vec3(0, 1, -1),
            new Vec3(1, 2, 0), new Vec3(-1, 2, 0), new Vec3(0, 2, 1), new Vec3(0, 2, -1)
        ];

        for (const offset of checkOffsets) {
            const checkPos = basePos.plus(offset);
            const block = this.bot.blockAt(checkPos);
            if (block && (this.isObstructiveBlock(block) || this.isHardObstacle(block))) {
                await this.digBlockAt(checkPos);
                await System.delay(50);
                return;
            }
        }
    }

    /**
     * Walks, jumps, and manages movements towards target coordinates.
     * @param targetPos Target walk destination coordinates.
     * @param process Active running process.
     * @param timeout Path execution timeout limit.
     * @returns A promise resolving to true if target is reached.
     */
    public async walkToTarget(targetPos: Vec3, process?: NavigationProcess, timeout = 3000): Promise<boolean> { 
        this.activeWalkTarget = targetPos; 
        const start = Date.now(); 

        let lastPos = this.bot.entity.position.clone(); 
        let lastCheckTime = Date.now(); 
        let stuckAccumulator = 0; 
        
        let steerUntil = 0;
        let activeSteerSide: 'left' | 'right' | null = null;

        const targetIsLower = targetPos.y < this.bot.entity.position.y - 0.25; 
        const targetIsHigher = targetPos.y > this.bot.entity.position.y + 0.25; 

        const config = process?.goal.config; 
        const allowSprint = config ? config.allowSprint : true; 

        this.bot.setControlState('sprint', false); 
        this.bot.setControlState('jump', false); 

        try { 
            while (Date.now() - start < timeout) { 
                if (process?.isAborted()) return false; 

                if (this.isDiggingObstacle) {
                    this.clearControlStates();
                    await System.delay(100);
                    continue;
                }

                if (this.isEating) {
                    this.clearControlStates();
                    await System.delay(100); 
                    continue; 
                }

                const botPos = this.bot.entity.position;
                if (!botPos) return false;

                const botPosFloored = botPos.floored();
                const targetPosFloored = targetPos.floored();

                const myFeet = this.bot.blockAt(botPosFloored);
                const myHead = this.bot.blockAt(botPosFloored.offset(0, 1, 0));
                const targetFeet = this.bot.blockAt(targetPosFloored);
                const targetHead = this.bot.blockAt(targetPosFloored.offset(0, 1, 0));

                if (myFeet && this.isObstructiveBlock(myFeet)) {
                    await this.digBlockAt(myFeet.position);
                    await System.delay(50);
                    continue;
                }
                if (myHead && this.isObstructiveBlock(myHead)) {
                    await this.digBlockAt(myHead.position);
                    await System.delay(50);
                    continue;
                }
                if (targetFeet && this.isObstructiveBlock(targetFeet)) {
                    await this.digBlockAt(targetFeet.position);
                    await System.delay(50);
                    continue;
                }
                if (targetHead && this.isObstructiveBlock(targetHead)) {
                    await this.digBlockAt(targetHead.position);
                    await System.delay(50);
                    continue;
                }

                const distXZ = Math.sqrt(Math.pow(targetPos.x - botPos.x, 2) + Math.pow(targetPos.z - botPos.z, 2)); 
                const inWater = this.isBotInWater(); 

                if (targetIsLower) { 
                    const arrivedY = botPos.y <= targetPos.y + 0.18; 
                    if (distXZ < 0.25 && arrivedY) return true; 
                } else if (targetIsHigher) { 
                    const arrivedY = botPos.y >= targetPos.y - 0.15; 
                    if (arrivedY && distXZ < 0.65) return true; 
                } else { 
                    if (distXZ < 0.22) return true; 
                } 

                const now = Date.now();

                const ignoreStuck = (inWater && targetIsHigher); 
                if (!ignoreStuck && now - lastCheckTime > 120) { 
                    const distMoved = botPos.distanceTo(lastPos); 
                    const velocityXZ = Math.sqrt( 
                        Math.pow(this.bot.entity.velocity.x, 2) + 
                        Math.pow(this.bot.entity.velocity.z, 2) 
                    ); 

                    const isStuck = inWater ? (distMoved < 0.02) : (distMoved < 0.04 && velocityXZ < 0.02); 

                    if (isStuck) { 
                        stuckAccumulator++; 
                        if (stuckAccumulator >= 3) {
                            await this.recoverFromStuck();
                            stuckAccumulator = 0;
                        } else if (stuckAccumulator >= 2) { 
                            activeSteerSide = (Math.random() > 0.5) ? 'left' : 'right'; 
                            steerUntil = now + 120; 
                        } 
                    } else { 
                        stuckAccumulator = 0; 
                    } 
                    lastPos = botPos.clone(); 
                    lastCheckTime = now; 
                } 

                if (inWater) { 
                    if (targetIsHigher) { 
                        this.bot.setControlState('jump', true); 
                        this.bot.setControlState('sprint', allowSprint); 
                        this.bot.setControlState('forward', distXZ > 0.2); 
                    } else if (targetIsLower) { 
                        this.bot.setControlState('jump', false); 
                        this.bot.setControlState('forward', true); 
                    } else { 
                        this.bot.setControlState('jump', this.bot.entity.velocity.y < -0.05); 
                        this.bot.setControlState('forward', true); 
                    } 
                } else { 
                    if (now < steerUntil && activeSteerSide) {
                        this.bot.setControlState('forward', false);
                        this.bot.setControlState(activeSteerSide, true);
                    } else {
                        if (activeSteerSide) {
                            this.bot.setControlState(activeSteerSide, false);
                            activeSteerSide = null;
                        }
                        this.bot.setControlState('forward', true);

                        if (targetIsHigher) { 
                            if (distXZ < 1.25) { 
                                if (this.bot.entity.onGround) {
                                    this.bot.setControlState('jump', true);
                                } else {
                                    this.bot.setControlState('jump', false);
                                }
                            } else {
                                this.bot.setControlState('jump', false);
                            }
                        } else { 
                            this.bot.setControlState('jump', false); 
                            this.bot.setControlState('sprint', allowSprint && distXZ > 1.2); 
                        } 
                    } 
                } 

                if (!this.mlgActive && !this.isAttacking && !this.isDiggingObstacle) {
                    const dx = targetPos.x - botPos.x;
                    const dz = targetPos.z - botPos.z;
                    const yaw = Math.atan2(-dx, -dz);
                    
                    let pitch = 0; 

                    if (Math.abs(targetPos.y - botPos.y) > 0.8) {
                        const dy = (targetPos.y + 0.5) - (botPos.y + this.bot.entity.height);
                        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        pitch = Math.asin(dy / (r || 1));
                        pitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, pitch));
                    }

                    this.bot.look(yaw, pitch, true); 
                }
                
                await System.delay(50); 
            } 
        } finally { 
            this.activeWalkTarget = null; 
            this.bot.setControlState('forward', false); 
            this.bot.setControlState('jump', false); 
            this.bot.setControlState('sprint', false); 
            if (activeSteerSide) {
                this.bot.setControlState(activeSteerSide, false);
            }
        } 
        return false; 
    }

    /**
     * Standard compatibility alias for terminating the active navigation process.
     */
    public stop(): void { this.stopNavigation(); }

    /**
     * Standard compatibility alias for resetting bot movement control states.
     */
    public resetControls(): void { this.clearControlStates(); }

    /**
     * Standard compatibility alias for equipping an item by ID name to the main hand.
     * @param itemId Item target string identifier.
     * @returns A promise resolving to true if equipped, false otherwise.
     */
    public async equipItem(itemId: string): Promise<boolean> { return this.equipItemByName(itemId); }

    /**
     * Standard compatibility alias for digging a block at the specified coordinate.
     * @param pos Location coordinates of block.
     */
    public async dig(pos: Vec3): Promise<void> { return this.digBlockAt(pos); }

    /**
     * Standard compatibility alias for transparent block checking.
     * @param block Target query block.
     * @returns True if coordinate poses no physical collision bounds.
     */
    public isTransparentObstacle(block: any): boolean { return this.isTransparentBlock(block); }

    /**
     * Standard compatibility alias for determining if the bot is in water.
     * @returns True if bot is inside liquid water.
     */
    public isStandingInWater(): boolean { return this.isBotInWater(); }

    /**
     * Standard compatibility alias to check if location coordinates permit water bucket safety index mapping.
     * @param pos coordinate reference checking index.
     * @returns True if placement is safe for drop bucket tracking.
     */
    public isWaterPlacementSafe(pos: Vec3): boolean { return this.isBlockSafeForWater(pos); }

    /**
     * Standard compatibility alias for snapping bot placement to block coordinate centers.
     * @param centerXZ center coordinates.
     * @param process current navigating process.
     * @param timeout sequence execution timeout.
     * @returns A promise resolving to true if alignment succeeds.
     */
    public async alignToCenter(centerXZ: Vec3, process?: NavigationProcess, timeout = 800): Promise<boolean> { return this.alignToBlockCenter(centerXZ, process, timeout); }

    /**
     * Standard compatibility alias for holding execution until falling drops resolve.
     * @param targetY target floor height coordinate.
     * @param targetXZ target destination boundary plane coordinate.
     * @param process active running process task context.
     * @param timeout vertical drop tracking safety limit.
     * @returns A promise resolving to true if the fall completes successfully.
     */
    public async awaitFall(targetY: number, targetXZ: Vec3, process?: NavigationProcess, timeout = 3000): Promise<boolean> { return this.awaitFallCompletion(targetY, targetXZ, process, timeout); }

    /**
     * Standard compatibility alias to place a block at the target coordinate.
     * @param targetPos Target grid coordinate.
     * @param process Running navigation thread context instance.
     * @returns A promise resolving to true if block placement succeeds.
     */
    public async placeBlock(targetPos: Vec3, process: NavigationProcess): Promise<boolean> { return this.placeBlockAt(targetPos, process); }

    /**
     * Standard compatibility alias to construct scaffolding towers beneath the bot's position.
     * @param process Active tracking process context.
     * @returns A promise resolving to true if tower height escalation succeeds.
     */
    public async buildTower(process: NavigationProcess): Promise<boolean> { return this.buildTowerUp(process); }

    /**
     * Standard compatibility alias to bridge blocks towards target locations.
     * @param targetPos coordinate vector path index target.
     * @param process Active running process.
     * @returns A promise resolving to true if bridge block placement succeeds.
     */
    public async bridgeTo(targetPos: Vec3, process: NavigationProcess): Promise<boolean> { return this.bridgeToTarget(targetPos, process); }

    /**
     * Standard compatibility alias for walking, jumping, and managing movements towards target coordinates.
     * @param targetPos Target walk destination coordinates.
     * @param process Active running process.
     * @param timeout Path execution timeout limit.
     * @returns A promise resolving to true if target is reached.
     */
    public async traverseTo(targetPos: Vec3, process?: NavigationProcess, timeout = 3000): Promise<boolean> { return this.walkToTarget(targetPos, process, timeout); }

    /**
     * Standard compatibility alias for dispatching navigation sequences towards Goal tracking configurations.
     * @param goal target objective parameter.
     * @returns Output process tracker container.
     */
    public setGoal(goal: GoalBlock): NavigationProcess { return this.navigateTo(goal); }

    /**
     * Standard compatibility alias to count placeable items matching white lists.
     * @param allowedBlocksWhiteList target whitelisted block names.
     * @returns quantity index sum count.
     */
    public getPlaceableBlockCount(allowedBlocksWhiteList: string[]): number { return this.countPlaceableBlocks(allowedBlocksWhiteList); }

    /**
     * Standard compatibility alias to find the most abundant block for building inside inventory.
     * @param allowedBlocksWhiteList Whitelist block string name array.
     * @returns name identifier string or null.
     */
    public getBestBuildBlock(allowedBlocksWhiteList: string[]): string | null { return this.findBestBuildBlock(allowedBlocksWhiteList); }

    /**
     * Standard compatibility alias to run attack sequences against nearby hostiles.
     */
    public async autoAttackClosestMonster(): Promise<void> { return this.autoAttackNearestHostile(); }
}