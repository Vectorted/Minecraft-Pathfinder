/**
 * Pathfinding Process Controller.
 * 
 * @author Vectorted
 * @github https://github.com/Vectorted
 */

import { System } from './system/System.js' 
import { GoalBlock } from './goals/Goal.js' 

/**
 * Enumeration representing the operational lifecycles of a navigation task.
 */
export type ProcessStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED'; 

/**
 * Manages the state machine and loop execution for traversing a path toward a target Goal.
 * Coordinates path calculation, movement adjustments, structural actions, and failure detection.
 */
export class NavigationProcess { 
    /**
     * Internal reference to the managing system handling physical bot actions.
     */
    private system: System; 

    /**
     * The target positioning parameters and criteria governing path validation.
     */
    public goal: GoalBlock; 

    /**
     * Lifecycle status tracker reflecting the active phase of the task.
     */
    private status: ProcessStatus = 'PENDING'; 

    /**
     * Cancellation state flag denoting manual termination of the path execution sequence.
     */
    private aborted = false; 

    /**
     * Creates an instance of a navigation process tracking a specific goal.
     * @param system Reference context to the driving system.
     * @param goal Objective targeting criteria.
     */
    constructor(system: System, goal: GoalBlock) { 
        this.system = system; 
        this.goal = goal; 
    } 

    /**
     * Retrieves the current lifecycle process status.
     * @returns One of the defined status strings.
     */
    public getStatus(): ProcessStatus { 
        return this.status; 
    } 

    /**
     * Assesses whether execution should halt due to cancellation or state abortion.
     * @returns True if the task has been cancelled.
     */
    public isAborted(): boolean { 
        return this.aborted || this.status === 'CANCELLED'; 
    } 

    /**
     * Runs the continuous traversal loop, adjusting paths and executing task maneuvers.
     * @returns A promise resolving to true if destination is reached, false otherwise.
     */
    public async execute(): Promise<boolean> { 
        if (this.status !== 'PENDING') return false; 
        this.status = 'RUNNING'; 

        this.system.placedBlocks.clear(); 
        
        let lastPos = this.system.bot.entity.position.clone(); 
        let lastProgressTime = Date.now(); 
        let consecutivePathFailures = 0;

        const distance = lastPos.distanceTo(this.goal.pos);
        const totalTimeout = Math.max(180000, (distance / 3.2) * 1000 + 60000); 
        const startTime = Date.now(); 

        try { 
            while (Date.now() - startTime < totalTimeout) { 
                if (this.isAborted()) { 
                    this.status = 'CANCELLED'; 
                    return false; 
                } 

                if (this.goal.config.killAura) { 
                    await this.system.autoAttackClosestMonster(); 
                } 

                const botPos = this.system.bot.entity.position; 
                if (!botPos) { 
                    this.status = 'FAILED'; 
                    return false; 
                } 

                if (this.goal.isAtGoal(botPos)) { 
                    this.status = 'COMPLETED'; 
                    return true; 
                } 

                const path = await this.goal.calculatePath(this.system, botPos); 
                if (!path || path.length <= 1) { 
                    consecutivePathFailures++;
                    if (consecutivePathFailures > 40) {
                        this.status = 'FAILED'; 
                        return false; 
                    }
                    await System.delay(1500); 
                    continue; 
                } 
                consecutivePathFailures = 0;

                for (let i = 1; i < path.length; i++) { 
                    if (this.isAborted()) break; 

                    if (this.goal.config.killAura && i % 3 === 0) { 
                        await this.system.autoAttackClosestMonster(); 
                    } 

                    const current = path[i - 1]; 
                    const next = path[i]; 
                    const targetCenter = next.pos.offset(0.5, 0, 0.5); 
                    const currentCenter = current.pos.offset(0.5, 0, 0.5); 

                    let actionSucceeded = false; 

                    switch (next.actionType) { 
                        case 'walk': 
                        case 'fall': 
                            actionSucceeded = await this.system.traverseTo(targetCenter, this); 
                            break; 
                            
                        case 'tower': 
                            await this.system.alignToCenter(currentCenter, this, 800); 
                            const towerPlaced = await this.system.buildTower(this); 
                            if (towerPlaced) { 
                                await System.delay(120); 
                                const heightMatched = Math.abs(this.system.bot.entity.position.y - next.pos.y) <= 0.4; 
                                if (heightMatched) { 
                                    actionSucceeded = await this.system.traverseTo(targetCenter, this); 
                                } 
                            } 
                            break; 

                        case 'bridge': 
                            actionSucceeded = await this.system.bridgeTo(targetCenter, this); 
                            break; 

                        case 'dig-walk': 
                            if (this.goal.isColliding(this.system, next.pos)) { 
                                await this.system.dig(next.pos); 
                            } 
                            const headPos = next.pos.offset(0, 1, 0); 
                            if (this.goal.isColliding(this.system, headPos)) { 
                                await this.system.dig(headPos); 
                            } 
                            actionSucceeded = await this.system.traverseTo(targetCenter, this); 
                            break; 

                        case 'dig-down': 
                            const dirXZ = next.pos.minus(current.pos); 
                            dirXZ.y = 0; 
                            
                            const ceilingBlockPos = current.pos.plus(dirXZ).offset(0, 1, 0); 
                            const headBlockPos = current.pos.plus(dirXZ); 
                            const legBlockPos = current.pos.plus(dirXZ).offset(0, -1, 0); 
                            const floorBlockPos = legBlockPos.offset(0, -1, 0); 

                            await this.system.alignToCenter(currentCenter, this, 800); 

                            if (this.goal.isColliding(this.system, ceilingBlockPos)) { 
                                await this.system.dig(ceilingBlockPos); 
                            } 
                            if (this.goal.isColliding(this.system, headBlockPos)) { 
                                await this.system.dig(headBlockPos); 
                            } 
                            if (this.goal.isColliding(this.system, legBlockPos)) { 
                                await this.system.dig(legBlockPos); 
                            } 
                            if (!this.goal.isColliding(this.system, floorBlockPos)) { 
                                await this.system.placeBlock(floorBlockPos, this); 
                            } 

                            actionSucceeded = await this.system.traverseTo(targetCenter, this); 
                            if (actionSucceeded) { 
                                await this.system.awaitFall(next.pos.y, targetCenter, this, 1500); 
                            } 
                            break; 

                        case 'dig-down-straight': 
                            const standOnBlockPos = current.pos.offset(0, -1, 0); 

                            await this.system.alignToCenter(currentCenter, this, 800); 
                            await this.system.dig(standOnBlockPos); 

                            actionSucceeded = await this.system.awaitFall(next.pos.y, targetCenter, this, 2500); 
                            break; 
                    } 

                    if (!actionSucceeded || this.isAborted()) { 
                        break; 
                    } 
                } 

                if (this.isAborted()) break; 

                const currentPosition = this.system.bot.entity.position; 
                if (!currentPosition) { 
                    this.status = 'FAILED'; 
                    return false; 
                } 
                
                const now = Date.now();
                const movedSignificant = currentPosition.distanceTo(lastPos) > 0.85;
                const isWorking = this.system.isDiggingObstacle || 
                                  this.system.isEating || 
                                  this.system.mlgActive || 
                                  (this.system as any).isAttacking;

                if (movedSignificant || isWorking) {
                    lastProgressTime = now;
                    lastPos = currentPosition.clone();
                }

                if (now - lastProgressTime > 15000) { 
                    this.status = 'FAILED'; 
                    return false; 
                } 

                await System.delay(50); 
            } 
        } catch (err: any) { 
            this.status = 'FAILED'; 
            return false; 
        } 

        if (this.aborted || this.status === 'RUNNING') { 
            this.status = 'CANCELLED'; 
            return false; 
        } 

        this.status = 'FAILED'; 
        return false; 
    } 

    /**
     * Aborts the active path progression and commands motion control resets.
     */
    public stop(): void { 
        this.aborted = true; 
        this.status = 'CANCELLED'; 
        this.system.resetControls(); 
    } 
}