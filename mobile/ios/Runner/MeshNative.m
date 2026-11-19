#import "MeshNative.h"
@import Mobile;

@implementation MeshNative
+ (NSString *)start:(NSString *)state hostname:(NSString *)hostname control:(NSString *)control key:(NSString *)key error:(NSError **)error {
  return MobileStart(state, hostname, control, key, error);
}
+ (BOOL)networkChanged:(NSError **)error { return MobileNetworkChanged(error); }
+ (void)stop { MobileStop(); }
@end
