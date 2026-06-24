/**
 * Pathfinding algorithm class, the core pathfinding algorithm for Bots.
 * 
 * @author Vectorted
 * @github https://github.com/Vectorted
 * 
 */

import { Vec3 } from 'vec3' 
import { System } from '../system/System.js' 
import { type NavigationConfig, DEFAULT_NAV_CONFIG } from '../config/NavigationConfig.js'

/**
 * Enumeration of available movement and structural action types used during path traversal.
 */
export type NavAction = 'walk' | 'bridge' | 'tower' | 'fall' | 'dig-walk' | 'dig-down' | 'dig-down-straight'; 

/**
 * Represents a path node instance generated within the A* search tree.
 */
export interface PathNode { 
    /**
     * Coordinate position representing a calculated point in the world space.
     */
    pos: Vec3; 
    /**
     * The actual cost of the path from the starting state to this current configuration.
     */
    g: number; 
    /**
     * The evaluation estimate summarizing the cost sum of the state trajectory (g + h).
     */
    f: number; 
    /**
     * Parent node reference tracking the predecessor node of this node in the path.
     */
    parent: PathNode | null; 
    /**
     * Execution action requested to transition from parent configuration to this position.
     */
    actionType: NavAction; 
} 

/**
 * High-performance Binary Heap for A* open list operations.
 * Lowers A* complexity from O(N^2) to O(N log N).
 */
class BinaryHeap<T> {
    private content: T[] = [];
    private scoreFunction: (x: T) => number;

    constructor(scoreFunction: (x: T) => number) {
        this.scoreFunction = scoreFunction;
    }

    public push(element: T): void {
        this.content.push(element);
        this.bubbleUp(this.content.length - 1);
    }

    public pop(): T | undefined {
        const result = this.content[0];
        const end = this.content.pop();
        if (this.content.length > 0 && end !== undefined) {
            this.content[0] = end;
            this.sinkDown(0);
        }
        return result;
    }

    public size(): number {
        return this.content.length;
    }

    private bubbleUp(n: number): void {
        const element = this.content[n];
        const score = this.scoreFunction(element);
        while (n > 0) {
            const parentN = Math.floor((n + 1) / 2) - 1;
            const parent = this.content[parentN];
            if (score >= this.scoreFunction(parent)) break;
            this.content[parentN] = element;
            this.content[n] = parent;
            n = parentN;
        }
    }

    private sinkDown(n: number): void {
        const length = this.content.length;
        const element = this.content[n];
        const elemScore = this.scoreFunction(element);

        while (true) {
            const child2N = (n + 1) * 2;
            const child1N = child2N - 1;
            let swap: number | null = null;
            let child1Score = 0;

            if (child1N < length) {
                const child1 = this.content[child1N];
                child1Score = this.scoreFunction(child1);
                if (child1Score < elemScore) swap = child1N;
            }
            if (child2N < length) {
                const child2 = this.content[child2N];
                const child2Score = this.scoreFunction(child2);
                if (child2Score < (swap === null ? elemScore : child1Score)) swap = child2N;
            }

            if (swap === null) break;
            this.content[n] = this.content[swap];
            this.content[swap] = element;
            n = swap;
        }
    }
}

/**
 * Small utility yielding control back to the event loop thread to prevent processing lock.
 * @returns Resolving promise yielding thread control.
 */
const yieldToEventLoop = () => new Promise<void>(resolve => { 
    if (typeof setImmediate === 'function') { 
        setImmediate(resolve); 
    } else { 
        setTimeout(resolve, 0); 
    } 
}); 

/**
 * Base implementation of a pathfinding goal targeting a single coordinate block index in the world.
 */
export class GoalBlock { 
    /**
     * Vector coordinates denoting the target objective location.
     */
    public pos: Vec3; 

    /**
     * Active constraint configurations governing calculations, evasion rules, and build actions.
     */
    public readonly config: Required<NavigationConfig>;

    /**
     * Safety limit defining the maximum number of search nodes processed before path search terminates.
     */
    private readonly MAX_NODES_EXPANDED = 15000; 

    /**
     * Processing intervals defining evaluation tick counts between event loop yield breaks.
     */
    private readonly YIELD_INTERVAL = 300; 

    /**
     * Instantiates the GoalBlock coordinate targeting instance.
     * @param x X grid coordinate indexing position.
     * @param y Y grid coordinate indexing position.
     * @param z Z grid coordinate indexing position.
     * @param config Optional parameter options modifying navigation presets.
     */
    constructor(x: number, y: number, z: number, config?: NavigationConfig) { 
        this.pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)); 
        this.config = { ...DEFAULT_NAV_CONFIG, ...config };
    } 

    /**
     * Evaluates if coordinate vectors satisfy target requirements.
     * @param pos Query coordinate block target.
     * @returns True if coordinate matches.
     */
    public isSatisfied(pos: Vec3): boolean {
        return pos.equals(this.pos);
    }

    /**
     * Returns heuristic distance calculation values from a given position.
     * @param pos Evaluated tracking position.
     * @returns Distance calculation mapping heuristic costs.
     */
    public heuristic(pos: Vec3): number {
        return this.getHeuristic(pos, this.pos);
    }

    /**
     * Evaluates calculations estimating route costs between two coordinates.
     * @param p1 Coordinates of the starting point.
     * @param p2 Coordinates of the ending point.
     * @returns Floating heuristic weight value.
     */
    protected getHeuristic(p1: Vec3, p2: Vec3): number {
        const dx = Math.abs(p1.x - p2.x);
        const dy = p2.y - p1.y;
        const dz = Math.abs(p1.z - p2.z);
        const verticalCost = dy > 0 ? dy * 2.5 : Math.abs(dy) * 1.8;
        return (dx + dz) * 0.9 + verticalCost;
    }

    /**
     * Tests world state elements at a location coordinate to determine physical collisions.
     * @param system Reference context to the query system.
     * @param p Evaluated indexing position.
     * @returns True if the target coordinate possesses active collision bounds.
     */
    public isColliding(system: System, p: Vec3): boolean { 
        if (system.placedBlocks.has(p.toString())) return true;
        const block = system.bot.blockAt(p); 

        if (block === null || block === undefined) {
            const heights = system.getWorldHeightLimits();
            if (p.y >= heights.minHeight && p.y < heights.maxHeight) {
                const botY = Math.floor(system.bot.entity.position.y);
                return p.y < botY; 
            }
            return true;
        }

        if (system.isTransparentBlock(block)) return false;

        const name = block.name.toLowerCase();
        if (name.includes('water') || name.includes('bubble_column')) return false; 

        return !['air', 'cave_air', 'void_air'].includes(name); 
    } 

    /**
     * Checks if coordinates match block configurations presenting health hazards.
     * @param system Checking bot system.
     * @param p Evaluated index position vector.
     * @returns True if index contains hazards.
     */
    private isDangerousBlock(system: System, p: Vec3): boolean {
        const block = system.bot.blockAt(p);
        if (!block) return false;
        
        const name = block.name.toLowerCase();
        return name.includes('lava') || name.includes('magma') || name.includes('fire');
    }

    /**
     * Assesses space segments to determine if character scale entities fit through them safely.
     * @param system Checking system context.
     * @param p Target base coordinate.
     * @returns True if path bounds are traversable.
     */
    private isSpacePassable(system: System, p: Vec3): boolean { 
        const legBlock = system.bot.blockAt(p);
        const headBlock = system.bot.blockAt(p.offset(0, 1, 0));

        const legsOk = !this.isColliding(system, p) && 
                      !this.isDangerousBlock(system, p) && 
                      !system.isFlowingWater(legBlock);
                      
        const headOk = !this.isColliding(system, p.offset(0, 1, 0)) && 
                       !this.isDangerousBlock(system, p.offset(0, 1, 0)) && 
                       !system.isFlowingWater(headBlock);

        return legsOk && headOk; 
    } 

    /**
     * Assesses whether a selected coordinate block allows modification or mining actions.
     * @param system Control system reference.
     * @param p Targeted block coordinate vector.
     * @returns True if breaking is possible.
     */
    private isBlockMinable(system: System, p: Vec3): boolean {
        const block = system.bot.blockAt(p);
        if (!block) return false;
        if (system.isTransparentBlock(block) || ['air', 'cave_air', 'void_air'].includes(block.name)) return true;
        
        const name = block.name.toLowerCase();
        if (name.includes('water') || name.includes('bubble_column')) return true; 
        if (this.isDangerousBlock(system, p)) return false; 

        return block.diggable && block.name !== 'bedrock' && block.name !== 'barrier';
    }

    /**
     * Determines whether mining at the target position poses hazard risks like collapsing lava.
     * @param system Checking bot system.
     * @param p Index parameter coordinates.
     * @returns True if coordinate is safe to dig.
     */
    private isSafeToDig(system: System, p: Vec3): boolean {
        if (!this.isBlockMinable(system, p)) return false;

        const blockAbove = system.bot.blockAt(p.offset(0, 1, 0));
        if (blockAbove) {
            const aboveName = blockAbove.name.toLowerCase();
            if (aboveName.includes('water') || aboveName.includes('lava') || aboveName.includes('bubble_column')) {
                return false; 
            }
        }
        return true;
    }

    /**
     * Determines whether targeted positioning can sustain bot standing coordinates.
     * @param system Reference system tracking bot parameters.
     * @param p Targeted base coordinate.
     * @returns True if floor is solid to stand on.
     */
    private isWalkableFloor(system: System, p: Vec3): boolean {
        if (this.isDangerousBlock(system, p)) return false;
        return this.isColliding(system, p);
    }

    /**
     * Determines whether the targeted coordinate block contains water-like liquids.
     * @param system Reference checking bot system.
     * @param p Evaluated coordinates.
     * @returns True if index contains liquid water.
     */
    private isLiquid(system: System, p: Vec3): boolean {
        const block = system.bot.blockAt(p);
        if (!block) return false;
        const name = block.name.toLowerCase();
        return name.includes('water') || name.includes('bubble_column');
    }

    /**
     * Computes search cost penalties based on proximity to hostile entities or players.
     * @param system System tracking active scene updates.
     * @param pos Target spatial node checking index.
     * @returns Added cost penalty scale.
     */
    private getThreatPenalty(system: System, pos: Vec3): number {
        let penalty = 0;
        const bot = system.bot;

        for (const id in bot.entities) {
            const entity = bot.entities[id];
            if (!entity || entity === bot.entity || !entity.position) continue;

            const dist = pos.distanceTo(entity.position);
            if (dist > 10.0) continue; 

            if (this.config.evadeMonsters && entity.type === 'mob') {
                if (this.isHostileMob(entity)) {
                    penalty += Math.max(0, (10.0 - dist) * 15.0); 
                }
            }

            if (this.config.evadePlayers.length > 0 && (entity.type === 'player' || entity.type === 'other')) {
                const username = entity.username || entity.displayName || '';
                if (this.config.evadePlayers.includes(username)) {
                    penalty += Math.max(0, (12.0 - dist) * 20.0);
                }
            }
        }
        return penalty;
    }

    /**
     * Checks if the query target represents a hostile mob entity.
     * @param entity Target tracking object.
     * @returns True if target is hostile.
     */
    private isHostileMob(entity: any): boolean {
        if (!entity) return false;
        const name = (entity.displayName || entity.name || '').toLowerCase();
        const hostiles = [
            'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman',
            'phantom', 'drowned', 'husk', 'stray', 'pillager', 'ravager',
            'piglin', 'hoglin', 'wither', 'blaze', 'ghast', 'slime',
            'magma', 'shulker', 'silverfish', 'evoker', 'vex', 'guardian',
            'warden'
        ];
        return hostiles.some(h => name.includes(h));
    }

    /**
     * Resolves all valid neighboring nodes and navigation actions transitioning from coordinate positions.
     * @param system Control system reference.
     * @param u Node center checking position.
     * @returns Map structures listing neighbor transition routes.
     */
    private findNeighborNodes(system: System, u: Vec3): { pos: Vec3; cost: number; action: NavAction }[] { 
        const neighbors: { pos: Vec3; cost: number; action: NavAction }[] = []; 
        
        const blockAtU = system.bot.blockAt(u);
        const inWater = this.isLiquid(system, u);
        const isUFlowing = system.isFlowingWater(blockAtU);

        const buildBlockCount = system.countPlaceableBlocks(this.config.allowedBuildBlocks);
        const hasBlocks = buildBlockCount > 0;

        const { minHeight, maxHeight } = system.getWorldHeightLimits();

        if (inWater && !isUFlowing) {
            const vSwimUp = u.offset(0, 1, 0);
            if (vSwimUp.y < maxHeight && this.isSpacePassable(system, vSwimUp)) {
                neighbors.push({ pos: vSwimUp, cost: 1.1, action: 'walk' });
            }
        }

        if (!inWater && hasBlocks) {
            const destHeight = u.y + 1;
            if (destHeight < maxHeight) {
                if (!this.isColliding(system, u.offset(0, 2, 0)) && !this.isColliding(system, u.offset(0, 3, 0))) { 
                    neighbors.push({ pos: u.offset(0, 1, 0), cost: 3.0, action: 'tower' }); 
                } 
            }
        }

        const vDownStraight = u.offset(0, -1, 0);
        const supportBlock = u.offset(0, -2, 0);
        if (vDownStraight.y >= minHeight) {
            if (this.isSafeToDig(system, vDownStraight) && this.isColliding(system, supportBlock) && !this.isDangerousBlock(system, supportBlock)) {
                neighbors.push({ pos: vDownStraight, cost: 5.5, action: 'dig-down-straight' });
            }
        }

        const dirs = [ 
            new Vec3(1, 0, 0), 
            new Vec3(-1, 0, 0), 
            new Vec3(0, 0, 1), 
            new Vec3(0, 0, -1) 
        ]; 

        const dimStr = String(system.bot.game.dimension).toLowerCase();
        const isNether = dimStr.includes('nether') || (system.bot.game.dimension as any) === -1 || dimStr === '-1';

        const hasWaterBucket = !isNether && (
            system.bot.inventory.slots.some(slot => slot && slot.name === 'water_bucket') ||
            (system.bot.heldItem && system.bot.heldItem.name === 'water_bucket')
        );

        for (const dir of dirs) { 
            const vWalk = u.plus(dir); 
            
            const destBlock = system.bot.blockAt(vWalk);
            const floorPos = vWalk.offset(0, -1, 0);
            const floorBlock = system.bot.blockAt(floorPos);

            const isDestFlowing = system.isFlowingWater(destBlock);
            const isFloorFlowing = system.isFlowingWater(floorBlock);

            const flowPenalty = (isDestFlowing || isFloorFlowing) ? 45.0 : 0.0;
            const travelCost = this.isLiquid(system, vWalk) ? 3.5 : 1.0; 
            const safetyPenalty = this.getThreatPenalty(system, vWalk);

            if (this.isSpacePassable(system, vWalk)) { 
                const isFloorWalkable = this.isWalkableFloor(system, floorPos) || system.isStaticWater(floorBlock);
                
                if (isFloorWalkable) { 
                    neighbors.push({ pos: vWalk, cost: travelCost + flowPenalty + safetyPenalty, action: 'walk' }); 
                } 
                else if (hasBlocks && floorPos.y < maxHeight && (floorBlock?.name === 'air' || isFloorFlowing)) { 
                    neighbors.push({ pos: vWalk, cost: 4.0 + safetyPenalty, action: 'bridge' }); 
                } 
            } else {
                const legBlk = vWalk;
                const headBlk = vWalk.offset(0, 1, 0);
                const legSolid = this.isColliding(system, legBlk);
                const headSolid = this.isColliding(system, headBlk);

                if (legSolid || headSolid) {
                    const okLeg = !legSolid || this.isSafeToDig(system, legBlk);
                    const okHead = !headSolid || this.isSafeToDig(system, headBlk);
                    if (okLeg && okHead) {
                        neighbors.push({ pos: vWalk, cost: 6.0 + safetyPenalty, action: 'dig-walk' });
                    }
                }
            }

            const vAscend = u.plus(dir).offset(0, 1, 0);
            if (vAscend.y < maxHeight) {
                const headClearance = !this.isColliding(system, u.offset(0, 2, 0)); 
                if (headClearance && this.isSpacePassable(system, vAscend) && this.isWalkableFloor(system, vAscend.offset(0, -1, 0))) {
                    neighbors.push({ pos: vAscend, cost: travelCost + 1.2 + safetyPenalty, action: 'walk' });
                }
            }

            const vDown = u.plus(dir).offset(0, -1, 0);
            if (vDown.y >= minHeight) {
                const blockFloor = vDown.offset(0, -1, 0); 
                const blockLeg = vDown;                     
                const blockHead = vDown.offset(0, 1, 0);       
                const blockCeiling = vDown.offset(0, 2, 0);    

                if (this.isWalkableFloor(system, blockFloor)) {
                    if (this.isSafeToDig(system, blockLeg) && this.isSafeToDig(system, blockHead) && this.isSafeToDig(system, blockCeiling)) {
                        neighbors.push({ pos: vDown, cost: 5.0 + safetyPenalty, action: 'dig-down' });
                    }
                }
            }

            if (!this.isWalkableFloor(system, floorPos) && !this.isLiquid(system, floorPos)) {
                const vWalkHead = vWalk.offset(0, 1, 0);
                if (!this.isColliding(system, vWalk) && !this.isColliding(system, vWalkHead) &&
                    !this.isDangerousBlock(system, vWalk) && !this.isDangerousBlock(system, vWalkHead)) {

                    let foundFloor = false;
                    let landingY = u.y;
                    
                    const scanLimit = hasWaterBucket ? (minHeight + 1) : (u.y - 3);

                    for (let y = u.y - 1; y >= scanLimit; y--) {
                        const checkPos = new Vec3(vWalk.x, y, vWalk.z);
                        if (this.isColliding(system, checkPos)) {
                            landingY = y + 1; 
                            foundFloor = true;
                            break;
                        }
                        if (this.isDangerousBlock(system, checkPos)) {
                            break; 
                        }
                    }

                    if (foundFloor) {
                        const dy = landingY - u.y;
                        if (dy <= -1) {
                            const isDeepFall = dy <= -4;
                            let validFall = true;

                            if (isDeepFall) {
                                if (!hasWaterBucket) {
                                    validFall = false;
                                } else {
                                    const landingSurface = new Vec3(vWalk.x, landingY - 1, vWalk.z);
                                    if (!system.isBlockSafeForWater(landingSurface)) {
                                        validFall = false;
                                    }
                                }
                            }

                            if (validFall) {
                                const vFall = new Vec3(vWalk.x, landingY, vWalk.z);
                                const verticalPenalty = isDeepFall ? Math.abs(dy) * 0.2 : Math.abs(dy) * 0.5;
                                const cost = isDeepFall ? (15.0 + verticalPenalty) : (1.5 + verticalPenalty);

                                neighbors.push({ 
                                    pos: vFall, 
                                    cost: cost + safetyPenalty, 
                                    action: 'fall' 
                                });
                            }
                        }
                    }
                }
            }
        } 
        return neighbors; 
    } 

    /**
     * Executes the main A* navigation algorithms to construct optimal path networks connecting coordinates.
     * @param system Control system mapping target environments.
     * @param start Path starting coordinates.
     * @returns A promise resolving to an array of coordinate nodes representing path steps, or null.
     */
    public async calculatePath(system: System, start: Vec3): Promise<PathNode[] | null> { 
        const startNode: PathNode = { 
            pos: start.floored(), 
            g: 0, 
            f: this.heuristic(start.floored()),
            parent: null, 
            actionType: 'walk' 
        }; 

        const heap = new BinaryHeap<PathNode>(n => n.f);
        heap.push(startNode);

        const allNodes = new Map<string, PathNode>();
        allNodes.set(startNode.pos.toString(), startNode);

        const closedSet = new Set<string>(); 
        const toKey = (v: Vec3) => v.x + ',' + v.y + ',' + v.z; 

        let bestCandidate: PathNode = startNode; 
        let minHeuristic = this.heuristic(start.floored()); 
        let nodesProcessed = 0; 

        while (heap.size() > 0) { 
            if (nodesProcessed >= this.MAX_NODES_EXPANDED) { 
                break; 
            } 

            if (nodesProcessed > 0 && nodesProcessed % this.YIELD_INTERVAL === 0) { 
                await yieldToEventLoop(); 
            } 

            const current = heap.pop()!;
            const currKey = toKey(current.pos);
            if (closedSet.has(currKey)) continue;

            nodesProcessed++; 

            const hVal = this.heuristic(current.pos); 
            if (hVal < minHeuristic) { 
                minHeuristic = hVal; 
                bestCandidate = current; 
            } 

            if (this.isSatisfied(current.pos)) { 
                bestCandidate = current; 
                break; 
            } 

            closedSet.add(currKey); 

            for (const nbr of this.findNeighborNodes(system, current.pos)) { 
                const nbrKey = toKey(nbr.pos); 
                if (closedSet.has(nbrKey)) continue; 

                const gScore = current.g + nbr.cost; 
                const fScore = gScore + this.heuristic(nbr.pos); 

                const existingNode = allNodes.get(nbrKey); 
                if (existingNode) { 
                    if (gScore < existingNode.g) { 
                        const updatedNode: PathNode = {
                            pos: nbr.pos, 
                            g: gScore, 
                            f: fScore, 
                            parent: current, 
                            actionType: nbr.action 
                        };
                        allNodes.set(nbrKey, updatedNode);
                        heap.push(updatedNode);
                    } 
                } else { 
                    const newNode: PathNode = {
                        pos: nbr.pos, 
                        g: gScore, 
                        f: fScore, 
                        parent: current, 
                        actionType: nbr.action 
                    };
                    allNodes.set(nbrKey, newNode);
                    heap.push(newNode);
                } 
            } 
        } 

        const path: PathNode[] = []; 
        let curr: PathNode | null = bestCandidate; 
        while (curr) { 
            path.unshift(curr); 
            curr = curr.parent; 
        } 

        return path.length > 1 ? path : null; 
    } 

    /**
     * Determines whether the physical spatial offset boundaries of the bot match coordinate target points.
     * @param botPos Spatial coordinate vector indexing bot position.
     * @returns True if bot is within spatial tolerances of the goal block.
     */
    public isAtGoal(botPos: Vec3): boolean {
        const dx = Math.abs(botPos.x - (this.pos.x + 0.5));
        const dz = Math.abs(botPos.z - (this.pos.z + 0.5));
        const dy = Math.abs(botPos.y - this.pos.y);

        return dx < 0.28 && dz < 0.28 && dy < 0.5;
    }
}

/**
 * Goal satisfied when the distance between the bot and the target block sits inside a designated spherical radius.
 */
export class GoalNear extends GoalBlock {
    /**
     * Radial distance criteria bounding the satisfaction range.
     */
    public readonly range: number;

    /**
     * Instantiates the GoalNear distance tracking instance.
     * @param x X grid coordinate indexing position.
     * @param y Y grid coordinate indexing position.
     * @param z Z grid coordinate indexing position.
     * @param range Proximity sphere boundary.
     * @param config Optional parameter options modifying navigation presets.
     */
    constructor(x: number, y: number, z: number, range: number, config?: NavigationConfig) {
        super(x, y, z, config);
        this.range = range;
    }

    /**
     * Evaluates if coordinate vectors satisfy spherical target requirements.
     * @param pos Query coordinate block target.
     * @returns True if distance falls within bounds.
     */
    public override isSatisfied(pos: Vec3): boolean {
        return pos.distanceTo(this.pos) <= this.range;
    }

    /**
     * Returns heuristic distance calculation values from a given position.
     * @param pos Evaluated tracking position.
     * @returns Distance calculation mapping heuristic costs.
     */
    public override heuristic(pos: Vec3): number {
        const baseDist = this.getHeuristic(pos, this.pos);
        return Math.max(0, baseDist - this.range * 0.9);
    }

    /**
     * Determines whether the physical spatial offset boundaries of the bot match coordinate target points.
     * @param botPos Spatial coordinate vector indexing bot position.
     * @returns True if bot is within spatial tolerances.
     */
    public override isAtGoal(botPos: Vec3): boolean {
        const centerPos = this.pos.offset(0.5, 0, 0.5);
        const dist = botPos.distanceTo(centerPos);
        const dy = Math.abs(botPos.y - this.pos.y);
        return dist <= (this.range + 0.8) && dy < 2.2;
    }
}

/**
 * Goal represented by a three-dimensional tracking boundary box.
 */
export class GoalRange extends GoalBlock {
    /** Minimum X bound of target region. */
    public readonly minX: number;
    /** Maximum X bound of target region. */
    public readonly maxX: number;
    /** Minimum Y bound of target region. */
    public readonly minY: number;
    /** Maximum Y bound of target region. */
    public readonly maxY: number;
    /** Minimum Z bound of target region. */
    public readonly minZ: number;
    /** Maximum Z bound of target region. */
    public readonly maxZ: number;

    /**
     * Instantiates the GoalRange coordinate bounding box.
     * @param x Center point X coordinate.
     * @param y Center point Y coordinate.
     * @param z Center point Z coordinate.
     * @param dx Half distance offsets expanding block limits on X.
     * @param dy Half distance offsets expanding block limits on Y.
     * @param dz Half distance offsets expanding block limits on Z.
     * @param config Optional navigation settings options override.
     */
    constructor(
        x: number, y: number, z: number, 
        dx: number, dy: number, dz: number, 
        config?: NavigationConfig
    ) {
        super(x, y, z, config);
        const hx = Math.abs(dx);
        const hy = Math.abs(dy);
        const hz = Math.abs(dz);

        this.minX = this.pos.x - hx;
        this.maxX = this.pos.x + hx;
        this.minY = this.pos.y - hy;
        this.maxY = this.pos.y + hy;
        this.minZ = this.pos.z - hz;
        this.maxZ = this.pos.z + hz;
    }

    /**
     * Evaluates if coordinate vectors sit within bounding target ranges.
     * @param pos Query coordinate block target.
     * @returns True if coordinate sits inside bounding constraints.
     */
    public override isSatisfied(pos: Vec3): boolean {
        return pos.x >= this.minX && pos.x <= this.maxX &&
               pos.y >= this.minY && pos.y <= this.maxY &&
               pos.z >= this.minZ && pos.z <= this.maxZ;
    }

    /**
     * Returns heuristic distance calculation values from a given position.
     * @param pos Evaluated tracking position.
     * @returns Distance calculation mapping heuristic costs.
     */
    public override heuristic(pos: Vec3): number {
        const closestX = Math.max(this.minX, Math.min(pos.x, this.maxX));
        const closestY = Math.max(this.minY, Math.min(pos.y, this.maxY));
        const closestZ = Math.max(this.minZ, Math.min(pos.z, this.maxZ));
        return this.getHeuristic(pos, new Vec3(closestX, closestY, closestZ));
    }

    /**
     * Determines whether the physical spatial offset boundaries of the bot match coordinate target regions.
     * @param botPos Spatial coordinate vector indexing bot position.
     * @returns True if bot is within range limits.
     */
    public override isAtGoal(botPos: Vec3): boolean {
        return botPos.x >= this.minX - 0.28 && botPos.x <= this.maxX + 1.28 &&
               botPos.y >= this.minY - 0.5  && botPos.y <= this.maxY + 1.8 &&
               botPos.z >= this.minZ - 0.28 && botPos.z <= this.maxZ + 1.28;
    }
}

/**
 * Goal satisfied targeting positions sharing horizontal coordinates, discarding vertical heights.
 */
export class GoalXZ extends GoalBlock {
    /**
     * Instantiates the GoalXZ plane coordinate mapping objective.
     * @param x Target point coordinate on the X axis.
     * @param z Target point coordinate on the Z axis.
     * @param config Optional parameter options modifying navigation configurations.
     */
    constructor(x: number, z: number, config?: NavigationConfig) {
        super(x, 0, z, config);
    }

    /**
     * Evaluates if coordinate vectors satisfy horizontal target requirements.
     * @param pos Query coordinate block target.
     * @returns True if coordinate matches.
     */
    public override isSatisfied(pos: Vec3): boolean {
        return pos.x === this.pos.x && pos.z === this.pos.z;
    }

    /**
     * Returns distance calculation values tracking horizontal heuristic projections.
     * @param pos Evaluated tracking position.
     * @returns Distance estimation on the XZ grid space.
     */
    public override heuristic(pos: Vec3): number {
        const dx = Math.abs(pos.x - this.pos.x);
        const dz = Math.abs(pos.z - this.pos.z);
        return (dx + dz) * 0.9;
    }

    /**
     * Determines whether the physical spatial offset boundaries of the bot match horizontal coordinates.
     * @param botPos Spatial coordinate vector indexing bot position.
     * @returns True if bot position fits within XZ plane tolerances.
     */
    public override isAtGoal(botPos: Vec3): boolean {
        const dx = Math.abs(botPos.x - (this.pos.x + 0.5));
        const dz = Math.abs(botPos.z - (this.pos.z + 0.5));
        return dx < 0.28 && dz < 0.28;
    }
}

/**
 * Goal targeting locations sitting inside a flat horizontal radius from coordinate points.
 */
export class GoalNearXZ extends GoalBlock {
    /** Horizontal range boundary limit. */
    public readonly range: number;

    /**
     * Instantiates the GoalNearXZ proximity tracking objective.
     * @param x Target center coordinate on the X axis.
     * @param z Target center coordinate on the Z axis.
     * @param range Radial distance on the horizontal plane.
     * @param config Optional parameters modifying navigation configuration.
     */
    constructor(x: number, z: number, range: number, config?: NavigationConfig) {
        super(x, 0, z, config);
        this.range = range;
    }

    /**
     * Evaluates if query coordinate positions satisfy horizontal bounding limits.
     * @param pos Query coordinate block target.
     * @returns True if inside horizontal range bounds.
     */
    public override isSatisfied(pos: Vec3): boolean {
        const dx = pos.x - this.pos.x;
        const dz = pos.z - this.pos.z;
        return Math.sqrt(dx * dx + dz * dz) <= this.range;
    }

    /**
     * Returns distance calculation values tracking horizontal proximity heuristic checks.
     * @param pos Evaluated tracking position.
     * @returns Estimated cost values on XZ space.
     */
    public override heuristic(pos: Vec3): number {
        const dx = pos.x - this.pos.x;
        const dz = pos.z - this.pos.z;
        const distXZ = Math.sqrt(dx * dx + dz * dz);
        return Math.max(0, distXZ - this.range * 0.9);
    }

    /**
     * Checks if the horizontal layout projection coordinates of the bot match range parameters.
     * @param botPos Spatial coordinate vector indexing bot position.
     * @returns True if target horizontal offset matches bounds.
     */
    public override isAtGoal(botPos: Vec3): boolean {
        const dx = botPos.x - (this.pos.x + 0.5);
        const dz = botPos.z - (this.pos.z + 0.5);
        return Math.sqrt(dx * dx + dz * dz) <= (this.range + 0.8);
    }
}

/**
 * Dynamically tracks coordinates associated with moving player or entity instances.
 */
export class GoalFollow extends GoalBlock {
    /** Target tracked entity. */
    public readonly entity: any;

    /** Designated range limit for trailing the followed target entity. */
    public readonly range: number;

    /**
     * Instantiates the GoalFollow dynamic targeting instance.
     * @param entity Target tracking object referencing entity properties.
     * @param range Designated proximity offset limit.
     * @param config Optional parameter options modifying navigation.
     */
    constructor(entity: any, range: number, config?: NavigationConfig) {
        const initPos = entity?.position || new Vec3(0, 0, 0);
        super(initPos.x, initPos.y, initPos.z, config);
        this.entity = entity;
        this.range = range;
    }

    /**
     * Computes the current horizontal and vertical tracking coordinates of the entity.
     * @returns Vector mapping target locations.
     */
    private get targetPos(): Vec3 {
        return this.entity?.position ? this.entity.position.floored() : this.pos;
    }

    /**
     * Evaluates if coordinate vectors satisfy trailing target ranges.
     * @param pos Query coordinate block target.
     * @returns True if distance falls within following bounds.
     */
    public override isSatisfied(pos: Vec3): boolean {
        return pos.distanceTo(this.targetPos) <= this.range;
    }

    /**
     * Returns heuristic distance calculation values towards moving targets.
     * @param pos Evaluated tracking position.
     * @returns Estimated total trajectory cost calculations.
     */
    public override heuristic(pos: Vec3): number {
        const baseHeur = this.getHeuristic(pos, this.targetPos);
        return Math.max(0, baseHeur - this.range * 0.9);
    }

    /**
     * Checks if the physical configuration bounds of the bot are close enough to the entity coordinates.
     * @param botPos Spatial coordinate vector indexing bot position.
     * @returns True if distance and vertical separation values sit inside check limits.
     */
    public override isAtGoal(botPos: Vec3): boolean {
        const ep = this.entity?.position;
        if (!ep) return false;
        
        const dx = Math.abs(botPos.x - ep.x);
        const dz = Math.abs(botPos.z - ep.z);
        const dy = Math.abs(botPos.y - ep.y);
        const distXZ = Math.sqrt(dx * dx + dz * dz);

        return distXZ <= (this.range + 1.2) && dy < 2.5;
    }
}