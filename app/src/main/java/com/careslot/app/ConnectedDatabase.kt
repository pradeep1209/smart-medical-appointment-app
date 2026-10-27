package com.careslot.app

import android.content.Context
import androidx.room.*

@Entity(tableName = "account_cache")
data class ConnectedCache(@PrimaryKey val userId: String, val payload: String, val savedAt: Long = System.currentTimeMillis())
@Entity(tableName = "clinical_cache", primaryKeys = ["userId", "kind"])
data class ClinicalCache(val userId: String, val kind: String, val encrypted: String, val savedAt: Long = System.currentTimeMillis())
@Dao
interface ClinicalCacheDao {
    @Query("SELECT * FROM clinical_cache WHERE userId = :userId AND kind = :kind") fun read(userId: String, kind: String): ClinicalCache?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun save(value: ClinicalCache)
    @Query("DELETE FROM clinical_cache WHERE userId = :userId") fun delete(userId: String)
    @Query("DELETE FROM clinical_cache WHERE userId = :userId AND kind = :kind") fun deleteKind(userId: String, kind: String)
}
@Dao
interface ConnectedCacheDao {
    @Query("SELECT * FROM account_cache WHERE userId = :userId") fun read(userId: String): ConnectedCache?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun save(value: ConnectedCache)
    @Query("DELETE FROM account_cache WHERE userId = :userId") fun delete(userId: String)
}
@Database(entities = [ConnectedCache::class, ClinicalCache::class], version = 2, exportSchema = true)
abstract class ConnectedDatabase : RoomDatabase() {
    abstract fun cache(): ConnectedCacheDao
    abstract fun clinical(): ClinicalCacheDao
    companion object {
        @Volatile private var instance: ConnectedDatabase? = null
        fun get(context: Context): ConnectedDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, ConnectedDatabase::class.java, "care-connected.db").addMigrations(object : androidx.room.migration.Migration(1, 2) {
                override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) { db.execSQL("CREATE TABLE IF NOT EXISTS clinical_cache (userId TEXT NOT NULL, kind TEXT NOT NULL, encrypted TEXT NOT NULL, savedAt INTEGER NOT NULL, PRIMARY KEY(userId, kind))") }
            }).build().also { instance = it }
        }
    }
}
