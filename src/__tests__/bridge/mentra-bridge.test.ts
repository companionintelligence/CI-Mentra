jest.mock('@mentra/sdk', () => ({
  AppServer: class {},
  AppSession: class {},
}));

import { selectBridgeLayout, truncateForGlass } from '../../bridge/mentra-bridge.ts';

describe('Mentra bridge layout helpers', () => {
  it('uses a dashboard card when there is no active conversation text', () => {
    expect(selectBridgeLayout(undefined, undefined, 'Listening...')).toEqual({
      type: 'dashboard',
      leftText: 'Mentra Bridge',
      rightText: 'Listening...',
    });
  });

  it('uses a text wall for user-only transcript updates', () => {
    expect(selectBridgeLayout('hello there')).toEqual({
      type: 'text',
      text: 'You: hello there',
    });
  });

  it('uses a reference card for assistant-only content', () => {
    expect(selectBridgeLayout(undefined, 'A concise answer')).toEqual({
      type: 'reference',
      title: 'Assistant',
      text: 'A concise answer',
    });
  });

  it('uses a double text wall when both transcript and response are present', () => {
    expect(selectBridgeLayout('What time is it?', 'It is 3 PM.')).toEqual({
      type: 'double',
      topText: 'You: What time is it?',
      bottomText: 'Assistant: It is 3 PM.',
    });
  });

  it('truncates glass text safely', () => {
    expect(truncateForGlass('  abc   def  ', 6)).toBe('abc d…');
  });
});
