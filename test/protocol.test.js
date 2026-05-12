import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PROTOCOL_VERSION,
    ProtocolError,
    createPlayerJoinedMessage,
    createRoomSnapshotMessage,
    encodeMessage,
    parseClientMessage
} from '../src/protocol.js';

test('encodeMessage 会为服务端消息自动补齐协议版本字段', () =>
{
    const encoded = encodeMessage(createRoomSnapshotMessage({
        roomCode: 'ABCDEF',
        players: [
            {
                playerId: 'player-1',
                playerName: '主机',
                state: null
            }
        ]
    }));
    const parsed = JSON.parse(encoded);

    assert.equal(parsed.v, PROTOCOL_VERSION);
    assert.equal(parsed.type, 'room_snapshot');
    assert.equal(parsed.roomCode, 'ABCDEF');
    assert.deepEqual(parsed.players, [
        {
            playerId: 'player-1',
            playerName: '主机',
            state: null
        }
    ]);
});

test('parseClientMessage 会把旧版 sync_state 兼容为 player_state_update', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'sync_state',
        roomCode: 'ABCDEF',
        data: {
            pomodoro: {
                phase: 0,
                remainingSeconds: 1200,
                currentRound: 1,
                totalRounds: 4,
                isRunning: false
            },
            activeApp: null
        }
    }));

    assert.equal(message.type, 'player_state_update');
    assert.equal(message.roomCode, 'ABCDEF');
    assert.equal(message.state.pomodoro.remainingSeconds, 1200);
});

test('parseClientMessage 在协议版本不匹配时抛出 INVALID_VERSION', () =>
{
    assert.throws(
        () => parseClientMessage(JSON.stringify({
            v: PROTOCOL_VERSION + 1,
            type: 'create_room',
            playerName: '版本错误'
        })),
        (error) => error instanceof ProtocolError && error.code === 'INVALID_VERSION'
    );
});

test('parseClientMessage 在 player_state_update 中保留 bindingKey 字段（远端按键同步必需）', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'Space', pressCount: 47 }
        }
    }));

    // 历史 bug：normalizeRemoteState 没把 bindingKey 复制到归一化结果，导致 broadcast 出口字段丢失。
    assert.deepEqual(message.state.bindingKey, { keyLabel: 'Space', pressCount: 47 });
});

test('parseClientMessage 在 bindingKey=null 时 normalizeRemoteState 显式产出 null（区别于"字段缺失"）', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: null
        }
    }));

    assert.equal(Object.prototype.hasOwnProperty.call(message.state, 'bindingKey'), true);
    assert.equal(message.state.bindingKey, null);
});

test('parseClientMessage 把 bindingKey.pressCount 钳到 0 以上（防止客户端 bug 发负值）', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'Space', pressCount: -5 }
        }
    }));

    assert.equal(message.state.bindingKey.pressCount, 0);
});

test('parseClientMessage 兼容旧客户端：state 中不带 bindingKey 字段时返回 null', () =>
{
    // 老版本客户端发的 player_state_update 没有 bindingKey 字段；新服务端必须当成 null 透传，
    // 而不是抛 INVALID_MESSAGE，否则升级期老客户端会被直接挤掉。
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null
        }
    }));

    assert.equal(Object.prototype.hasOwnProperty.call(message.state, 'bindingKey'), true);
    assert.equal(message.state.bindingKey, null);
});

test('parseClientMessage 会过滤 bindingKey 中不在白名单内的字段', () =>
{
    const message = parseClientMessage(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'player_state_update',
        state: {
            pomodoro: { phase: 0, remainingSeconds: 1500, currentRound: 1, totalRounds: 4, isRunning: true },
            activeApp: null,
            bindingKey: { keyLabel: 'F', pressCount: 3, evilExtra: 'should-be-stripped', __proto__: { x: 1 } }
        }
    }));

    // 防止旁路注入：只保留 keyLabel + pressCount。
    assert.deepEqual(message.state.bindingKey, { keyLabel: 'F', pressCount: 3 });
});

test('player_joined 使用 players 数组携带远端玩家资料，避免新增字段', () =>
{
    const encoded = encodeMessage(createPlayerJoinedMessage({
        roomCode: 'ABCDEF',
        player: {
            playerId: 'player-2',
            playerName: '加入者',
            state: null
        }
    }));
    const parsed = JSON.parse(encoded);

    assert.deepEqual(parsed, {
        v: PROTOCOL_VERSION,
        type: 'player_joined',
        roomCode: 'ABCDEF',
        players: [
            {
                playerId: 'player-2',
                playerName: '加入者',
                state: null
            }
        ]
    });
});
