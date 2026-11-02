import type { Device } from '@mentra/bluetooth-sdk';
import { File, Paths } from 'expo-file-system';

import { toSavedDeviceRecord } from '../lib/savedDevice';
import { savedDeviceStorage } from './savedDeviceStorage';

// Stands in for the one file the app keeps. It has the parts of expo-file-system's File that
// savedDeviceStorage uses: exists, text, create, write and delete.
type FakeFile = {
  exists: boolean;
  content: string;
  text: jest.Mock;
  create: jest.Mock;
  write: jest.Mock;
  delete: jest.Mock;
};

function createFakeFile(): FakeFile {
  const file: FakeFile = {
    exists: false,
    content: '',
    text: jest.fn(async () => file.content),
    create: jest.fn(() => {
      file.exists = true;
      file.content = '';
    }),
    write: jest.fn((content: string) => {
      file.content = content;
    }),
    delete: jest.fn(() => {
      file.exists = false;
      file.content = '';
    }),
  };
  return file;
}

// jest.mock is hoisted above the imports, so the factory runs before this line. The factory only
// reads mockFile when savedDeviceStorage calls `new File(...)`, which happens inside a test.
let mockFile = createFakeFile();

jest.mock('expo-file-system', () => ({
  File: jest.fn(() => mockFile),
  Paths: { document: 'mock-documents' },
}));

const SAVED_AT = 1_700_000_000_000;

const scanned: Device = {
  id: 'AA:BB:CC:DD:EE:FF',
  model: 'Mentra Live',
  name: 'Mentra Live 1A2B',
  address: 'AA:BB:CC:DD:EE:FF',
  rssi: -61,
  pairingMode: true,
  pairingCode: 'F00D',
};

const savedGlasses = {
  id: 'AA:BB:CC:DD:EE:FF',
  model: 'Mentra Live',
  name: 'Mentra Live 1A2B',
  address: 'AA:BB:CC:DD:EE:FF',
};

describe('savedDeviceStorage', () => {
  let dateNow: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFile = createFakeFile();
    dateNow = jest.spyOn(Date, 'now').mockReturnValue(SAVED_AT);
  });

  afterEach(() => {
    dateNow.mockRestore();
  });

  describe('load', () => {
    test('returns null when no record has been saved', async () => {
      await expect(savedDeviceStorage.load()).resolves.toBeNull();
      expect(mockFile.text).not.toHaveBeenCalled();
    });

    test('returns the saved glasses from a valid record, without the pairing code', async () => {
      mockFile.exists = true;
      mockFile.content = JSON.stringify(toSavedDeviceRecord(scanned, 1));
      await expect(savedDeviceStorage.load()).resolves.toStrictEqual(savedGlasses);
    });

    test('returns null for corrupt JSON', async () => {
      mockFile.exists = true;
      mockFile.content = '{"version": 1, "device": ';
      await expect(savedDeviceStorage.load()).resolves.toBeNull();
    });
  });

  describe('save', () => {
    test('save(null) deletes an existing record', async () => {
      mockFile.exists = true;
      mockFile.content = JSON.stringify(toSavedDeviceRecord(scanned, 1));
      await savedDeviceStorage.save(null);
      expect(mockFile.delete).toHaveBeenCalledTimes(1);
      expect(mockFile.exists).toBe(false);
      expect(mockFile.create).not.toHaveBeenCalled();
      expect(mockFile.write).not.toHaveBeenCalled();
    });

    test('save(null) does nothing when no record exists', async () => {
      await savedDeviceStorage.save(null);
      expect(mockFile.delete).not.toHaveBeenCalled();
      expect(mockFile.create).not.toHaveBeenCalled();
      expect(mockFile.write).not.toHaveBeenCalled();
    });

    test('save(device) creates the file with intermediates and overwrite, then writes the record', async () => {
      await savedDeviceStorage.save(scanned);

      expect(File).toHaveBeenCalledWith(Paths.document, 'companion-saved-glasses.json');
      expect(mockFile.create).toHaveBeenCalledWith({ intermediates: true, overwrite: true });
      expect(mockFile.create.mock.invocationCallOrder[0]).toBeLessThan(mockFile.write.mock.invocationCallOrder[0]);
      expect(mockFile.write).toHaveBeenCalledTimes(1);

      const written: string = mockFile.write.mock.calls[0][0];
      expect(JSON.parse(written)).toStrictEqual({ version: 1, savedAt: SAVED_AT, device: savedGlasses });
      expect(written).not.toContain('F00D');
    });

    test('a saved device loads back unchanged', async () => {
      await savedDeviceStorage.save(scanned);
      await expect(savedDeviceStorage.load()).resolves.toStrictEqual(savedGlasses);
    });
  });
});
