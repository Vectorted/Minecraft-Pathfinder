/**
 * Navigation system core module.
 * Provides pathfinding and movement control for Minecraft bots.
 * 
 * @author Vectorted
 * @github https://github.com/Vectorted
 * 
 * @module navigation
 * @see {@link System} - Main navigation controller
 * @see {@link GoalBlock} - Single block targeting goal
 * @see {@link GoalNear} - Proximity-based targeting goal
 * @see {@link GoalNearXZ} - 2D horizontal proximity goal
 * @see {@link GoalRange} - Radius-based targeting goal
 * @see {@link GoalXZ} - 2D horizontal targeting goal
 * @see {@link GoalFollow} - Entity following goal
 */

import { System } from './module/system/System.js';
import { GoalBlock, GoalNear, GoalNearXZ, GoalRange, GoalXZ, GoalFollow } from './module/goals/Goal.js';

/**
 * Navigation system for Minecraft bot pathfinding.
 * 
 * @exports
 * @property {typeof System} System - Main navigation controller class that manages bot movement,
 *   pathfinding, and goal execution.
 * @property {typeof GoalBlock} GoalBlock - Goal implementation for navigating to a specific block position.
 *   Uses exact block coordinates as the target.
 * @property {typeof GoalFollow} GoalFollow - Goal implementation for following a target entity.
 *   Tracks and pursues moving entities with configurable follow distance.
 * @property {typeof GoalNear} GoalNear - Goal implementation for navigating near a specific position.
 *   Accepts a radius tolerance to stop within range of the target.
 * @property {typeof GoalNearXZ} GoalNearXZ - Goal implementation for horizontal-only proximity navigation.
 *   Ignores Y-axis variation and navigates to within range of XZ coordinates.
 * @property {typeof GoalRange} GoalRange - Goal implementation for navigating to any position within
 *   a specified radius from the target center.
 * @property {typeof GoalXZ} GoalXZ - Goal implementation for horizontal-only navigation to exact XZ coordinates.
 *   Maintains current Y position while moving to target horizontally.
 */
export {
    System,
    GoalBlock,
    GoalFollow,
    GoalNear,
    GoalNearXZ,
    GoalRange,
    GoalXZ
};