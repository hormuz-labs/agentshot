import Flutter
import UIKit
import Network

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var nativeChannel: FlutterMethodChannel?
  private let meshQueue = DispatchQueue(label: "si.agentshot.mesh")
  private let networkMonitor = NWPathMonitor()
  private var initialPairingLink: String?
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "AgentShotMesh") else { return }
    let channel = FlutterMethodChannel(name: "agentshot/native", binaryMessenger: registrar.messenger())
    nativeChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return }
      switch call.method {
      case "initialLink": result(self.initialPairingLink)
      case "meshStart":
        let args = call.arguments as? [String: Any] ?? [:]
        self.meshQueue.async {
          do {
            let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let state = base.appendingPathComponent("AgentShotMesh", isDirectory: true)
            try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
            let out = try MeshNative.start(state.path, hostname: "agentshot-iphone", control: args["control"] as? String ?? "", key: args["key"] as? String ?? "")
            DispatchQueue.main.async { result(out) }
          } catch {
            DispatchQueue.main.async { result(FlutterError(code: "mesh", message: "Could not initialize the mesh", details: nil)) }
          }
        }
      case "meshStop":
        self.meshQueue.async {
          MeshNative.stop()
          DispatchQueue.main.async { result(nil) }
        }
      case "meshNetworkChanged":
        self.meshQueue.async {
          do {
            try MeshNative.networkChanged()
            DispatchQueue.main.async { result(nil) }
          } catch {
            DispatchQueue.main.async { result(FlutterError(code: "mesh", message: "Could not refresh the mesh network", details: nil)) }
          }
        }
      default: result(FlutterMethodNotImplemented)
      }
    }
    networkMonitor.pathUpdateHandler = { [weak self] _ in
      self?.meshQueue.async {
        try? MeshNative.networkChanged()
      }
    }
    networkMonitor.start(queue: DispatchQueue(label: "si.agentshot.network"))
  }

  func receivePairingLink(_ url: URL) {
    initialPairingLink = url.absoluteString
    nativeChannel?.invokeMethod("link", arguments: url.absoluteString)
  }
}
