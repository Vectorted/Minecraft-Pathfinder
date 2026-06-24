/**
 * Configuration options specifying movement constraints, building materials,
 * auto-defense behavior, threat evasion, and consumption parameters for navigation.
 * 
 * @author Vectorted
 * @github https://github.com/Vectorted
 * 
 */
export interface NavigationConfig {
    /**
     * List of block identifiers permitted for bridge building and scaffolding.
     * Example: ['cobblestone', 'dirt'].
     */
    allowedBuildBlocks?: string[]; 

    /**
     * Determines whether the bot is allowed to sprint.
     * Disabling sprinting helps conserve hunger levels.
     */
    allowSprint?: boolean; 

    /**
     * Toggle to automatically attack hostile entities that enter the bot's range.
     */
    killAura?: boolean; 

    /**
     * Toggle to calculate pathfinding routes that dynamically actively evade hostile mobs.
     */
    evadeMonsters?: boolean; 

    /**
     * List of player usernames/IDs designated to be avoided during path planning.
     */
    evadePlayers?: string[]; 

    /**
     * Toggle to automatically consume food when hunger or health thresholds are met.
     */
    autoEat?: boolean;

    /**
     * Hunger level threshold (0-20) below which food consumption is triggered.
     * Defaults to 14, representing 7 hunger points.
     */
    autoEatThreshold?: number;

    /**
     * Health level threshold (0-20) below which food consumption is triggered.
     * Defaults to 19, representing 9.5 hearts of health.
     */
    autoEatHealthThreshold?: number;

    /**
     * Prioritized whitelist of items allowed for consumption, ordered from highest priority to lowest.
     */
    allowedFoodList?: string[];
} 

/**
 * Default navigation configuration containing baseline presets for movement,
 * evasion blocks, combat behavior, and food eating routines.
 */
export const DEFAULT_NAV_CONFIG: Required<NavigationConfig> = { 
    /**
     * Default collections of block names permitted for scaffold building and horizontal bridging operations.
     */
    allowedBuildBlocks: ['cobblestone', 'dirt', 'stone', 'oak_planks', 'netherrack'], 
    
    /**
     * Default movement speed classification state allowing hunger-consuming sprint runs.
     */
    allowSprint: true, 
    
    /**
     * Default combat active query monitor state triggering mechanical attacks on close hostiles.
     */
    killAura: false, 
    
    /**
     * Default route calculation parameters enabling active pathway detour around monster coordinates.
     */
    evadeMonsters: false, 
    
    /**
     * Default collection lists containing blacklist identifier targets avoided when mapping path nodes.
     */
    evadePlayers: [],
    
    /**
     * Default consumption monitor state scheduling automatic eating executions during health drops.
     */
    autoEat: false,
    
    /**
     * Default food saturation index boundary (0 to 20 scale) triggering automatic eating.
     */
    autoEatThreshold: 14,
    
    /**
     * Default absolute scale health indicator boundary (0 to 20 scale) triggering automatic eating.
     */
    autoEatHealthThreshold: 19,
    
    /**
     * Default descending priority list of food items matching auto-eat inventory search operations.
     */
    allowedFoodList: [
        /** 
         * Golden apple offering absorption and regeneration effects during critical health situations. 
         */
        'golden_apple',
        
        /** 
         * Enchanted golden apple providing top-tier defensive status buffs and damage resistance. 
         */
        'enchanted_golden_apple',
        
        /** 
         * Cooked beef providing high saturation and hunger restoration values. 
         */
        'cooked_beef',
        
        /** 
         * Cooked porkchop providing high saturation and hunger restoration values. 
         */
        'cooked_porkchop',
        
        /** 
         * Baked potato providing moderate hunger restoration and standard food saturation. 
         */
        'baked_potato',
        
        /** 
         * Bread providing basic hunger restoration values. 
         */
        'bread',
        
        /** 
         * Cooked mutton offering moderate hunger restoration values. 
         */
        'cooked_mutton',
        
        /** 
         * Cooked chicken offering moderate hunger restoration values. 
         */
        'cooked_chicken',
        
        /** 
         * Golden carrot providing the highest food saturation values in vanilla gameplay. 
         */
        'golden_carrot',
        
        /** 
         * Regular apple offering minor hunger restoration. 
         */
        'apple'
    ]
};