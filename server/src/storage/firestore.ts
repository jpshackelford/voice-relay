import type { RelayedTextMessage } from '../types.js';
import type { MessageStore } from './types.js';

export interface FirestoreStoreOptions {
  projectId?: string;
  collection?: string;
  maxMessages?: number;
}

/**
 * Firestore implementation of MessageStore.
 * 
 * To use this driver, install @google-cloud/firestore:
 *   npm install @google-cloud/firestore
 * 
 * Then uncomment the implementation below.
 */
export class FirestoreStore implements MessageStore {
  // private db: Firestore | null = null;
  // private readonly collectionName: string;
  // private readonly maxMessages: number;
  // private readonly projectId?: string;

  constructor(_options: FirestoreStoreOptions) {
    // this.projectId = options.projectId;
    // this.collectionName = options.collection ?? 'voice-relay-messages';
    // this.maxMessages = options.maxMessages ?? 100;
    throw new Error(
      'FirestoreStore not implemented. Install @google-cloud/firestore and uncomment the implementation.'
    );
  }

  async connect(): Promise<void> {
    // const { Firestore } = await import('@google-cloud/firestore');
    // this.db = new Firestore({ projectId: this.projectId });
    // console.log('[FirestoreStore] Connected');
  }

  async disconnect(): Promise<void> {
    // this.db = null;
    // console.log('[FirestoreStore] Disconnected');
  }

  async append(_message: RelayedTextMessage): Promise<void> {
    // if (!this.db) throw new Error('FirestoreStore not connected');
    // 
    // await this.db.collection(this.collectionName).add({
    //   ...message,
    //   createdAt: Firestore.FieldValue.serverTimestamp(),
    // });
    // 
    // // Optional: cleanup old messages (could be done via TTL policy instead)
  }

  async getRecent(_limit: number = 100): Promise<RelayedTextMessage[]> {
    // if (!this.db) throw new Error('FirestoreStore not connected');
    // 
    // const snapshot = await this.db
    //   .collection(this.collectionName)
    //   .orderBy('createdAt', 'desc')
    //   .limit(limit)
    //   .get();
    // 
    // return snapshot.docs
    //   .map(doc => doc.data() as RelayedTextMessage)
    //   .reverse();
    return [];
  }

  async getRecentBySession(_limit: number, _sessionId: string): Promise<RelayedTextMessage[]> {
    // if (!this.db) throw new Error('FirestoreStore not connected');
    // 
    // const snapshot = await this.db
    //   .collection(this.collectionName)
    //   .where('sessionId', '==', sessionId)
    //   .orderBy('createdAt', 'desc')
    //   .limit(limit)
    //   .get();
    // 
    // return snapshot.docs
    //   .map(doc => doc.data() as RelayedTextMessage)
    //   .reverse();
    return [];
  }

  async clear(): Promise<void> {
    // if (!this.db) throw new Error('FirestoreStore not connected');
    // 
    // const batch = this.db.batch();
    // const snapshot = await this.db.collection(this.collectionName).get();
    // snapshot.docs.forEach(doc => batch.delete(doc.ref));
    // await batch.commit();
  }
}
