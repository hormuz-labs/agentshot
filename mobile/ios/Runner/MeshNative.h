#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface MeshNative : NSObject
+ (nullable NSString *)start:(NSString *)state hostname:(NSString *)hostname control:(NSString *)control key:(NSString *)key error:(NSError **)error;
+ (BOOL)networkChanged:(NSError **)error;
+ (void)stop;
@end
NS_ASSUME_NONNULL_END
