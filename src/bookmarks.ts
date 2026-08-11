import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Bookmark = { url: string; title: string; ts: number };

const KEY = 'escudo:bookmarks';

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setBookmarks(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  function save(next: Bookmark[]) {
    setBookmarks(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }

  const add = useCallback((url: string, title: string) => {
    setBookmarks((prev) => {
      if (prev.some((b) => b.url === url)) return prev;
      const next = [{ url, title, ts: Date.now() }, ...prev];
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const remove = useCallback((url: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.url !== url);
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const has = useCallback((url: string) => bookmarks.some((b) => b.url === url), [bookmarks]);

  return { bookmarks, add, remove, has, save };
}
