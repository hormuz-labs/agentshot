// "Send to Manul" in the share sheet (Photos, Files, …). It doesn't send anything itself: it copies what it was given
// into the app group's share/ folder and opens the app at manul://share, which asks which project it goes into and
// sends it to the Mac (src/files.ts takeShared, src/outbox.ts). An extension has little memory and is ended as soon
// as it closes, so the long upload belongs to the app, which can carry on with it after a drop.
import UIKit
import UniformTypeIdentifiers

/// Shared with the app: APP_GROUP in src/files.ts and ios.entitlements in app.json.
private let appGroup = "group.com.hormuzlabs.manul.mobile"

/// What Manul takes, asked for in this order, so a video arrives as the movie rather than a still of it.
private let kinds: [UTType] = [.movie, .image, .audio, .data]

class ShareViewController: UIViewController {
  private let label = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let doneButton = UIButton(type: .system)

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    label.text = "Getting it ready for Manul…"
    label.numberOfLines = 0
    label.textAlignment = .center
    label.font = .preferredFont(forTextStyle: .body)
    doneButton.setTitle("Done", for: .normal)
    doneButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    doneButton.isHidden = true
    doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [spinner, label, doneButton])
    stack.axis = .vertical
    stack.spacing = 16
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
    ])
    spinner.startAnimating()
    Task { await take() }
  }

  /// Copy every attachment into a hidden folder, then unhide it: the app only picks up a share once it is whole.
  private func take() async {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      return show("Manul couldn't take this. Open Manul and add it from there.")
    }
    let id = UUID().uuidString
    let share = container.appendingPathComponent("share", isDirectory: true)
    let incoming = share.appendingPathComponent(".\(id)", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: incoming, withIntermediateDirectories: true)
      var count = 0
      let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
      for provider in providers {
        guard let kind = kinds.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) else { continue }
        try await copy(provider, kind, into: incoming)
        count += 1
      }
      if count == 0 {
        try? FileManager.default.removeItem(at: incoming)
        return show("There's nothing here Manul can use.")
      }
      try FileManager.default.moveItem(at: incoming, to: share.appendingPathComponent(id, isDirectory: true))
    } catch {
      try? FileManager.default.removeItem(at: incoming)
      return show("Manul couldn't take this. \(error.localizedDescription)")
    }
    if await openApp(URL(string: "manul://share")!) {
      finish()
    } else {
      show("Open Manul to choose the project it goes into.")
    }
  }

  /// One attachment, copied while the system's temporary copy of it still exists (only inside the callback).
  private func copy(_ provider: NSItemProvider, _ kind: UTType, into dir: URL) async throws {
    let suggested = provider.suggestedName
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
      _ = provider.loadFileRepresentation(forTypeIdentifier: kind.identifier) { url, error in
        guard let url else { return done.resume(throwing: error ?? CocoaError(.fileReadUnknown)) }
        do {
          try FileManager.default.copyItem(at: url, to: freeURL(in: dir, name: fileName(suggested, url)))
          done.resume()
        } catch {
          done.resume(throwing: error)
        }
      }
    }
  }

  /// Open the app. Extensions may not call UIApplication.open directly, so it is found along the responder chain and
  /// called by name (as other share extensions do; the plain openURL: no longer works from iOS 18).
  private func openApp(_ url: URL) async -> Bool {
    var responder: UIResponder? = self
    while let r = responder {
      if let app = r as? UIApplication {
        let sel = NSSelectorFromString("openURL:options:completionHandler:")
        guard app.responds(to: sel) else { return false }
        typealias Open = @convention(c) (NSObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
        let open = unsafeBitCast(app.method(for: sel), to: Open.self)
        return await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
          open(app, sel, url as NSURL, NSDictionary(), { ok in done.resume(returning: ok) })
        }
      }
      responder = r.next
    }
    return false
  }

  private func show(_ message: String) {
    spinner.stopAnimating()
    label.text = message
    doneButton.isHidden = false
  }

  @objc private func finish() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}

/// Photos suggests "IMG_0042" and hands over "…/IMG_0042.MOV" or a temporary name: keep the suggestion, with the
/// file's extension.
private func fileName(_ suggested: String?, _ url: URL) -> String {
  let ext = url.pathExtension
  var name = suggested ?? url.lastPathComponent
  if !ext.isEmpty && !name.lowercased().hasSuffix("." + ext.lowercased()) { name += "." + ext }
  name = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
  return name.hasPrefix(".") ? String(name.drop(while: { $0 == "." })) : name
}

/// `name` in `dir`, or "name 2", "name 3"… if it is taken.
private func freeURL(in dir: URL, name: String) -> URL {
  let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
  var url = dir.appendingPathComponent(name), n = 2
  while FileManager.default.fileExists(atPath: url.path) {
    url = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
    n += 1
  }
  return url
}
